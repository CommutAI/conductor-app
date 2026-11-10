#!/usr/bin/env python3
"""
SMS Queue Processor for CommuteAI
Polls Supabase for pending SMS messages and sends them via SIM900
"""

import os
import sys
import time
import logging
from datetime import datetime
from typing import Dict, List
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Try to import required modules
try:
    import serial
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    logger.error("pyserial not installed. Install with: pip install pyserial")

try:
    from supabase import create_client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False
    logger.error("supabase not installed. Install with: pip install supabase")


class SMSQueueProcessor:
    """Processes SMS queue from Supabase"""

    def __init__(self):
        self.serial_connection = None
        self.connected = False
        self.supabase = None

        # Configuration
        self.port = os.getenv('SIM900A_PORT', '/dev/ttyUSB0')
        self.baudrate = int(os.getenv('SIM900A_BAUDRATE', '9600'))
        self.supabase_url = os.getenv('SUPABASE_URL')
        self.supabase_key = os.getenv('SUPABASE_KEY')
        self.poll_interval = int(os.getenv('SMS_POLL_INTERVAL', '10'))  # seconds
        self.max_concurrent = int(os.getenv('MAX_CONCURRENT_SMS', '5'))

        # Initialize
        self._init_supabase()
        self._connect_hardware()

    def _init_supabase(self):
        """Initialize Supabase client"""
        if not SUPABASE_AVAILABLE:
            logger.warning("Supabase client not available")
            return

        if not self.supabase_url or not self.supabase_key:
            logger.warning("Supabase credentials not configured")
            return

        try:
            self.supabase = create_client(self.supabase_url, self.supabase_key)
            logger.info("Supabase client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase: {e}")

    def _connect_hardware(self) -> bool:
        """Connect to SIM900A module"""
        if not SERIAL_AVAILABLE:
            logger.error("Serial library not available")
            return False

        try:
            self.serial_connection = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=5  # Increased timeout
            )

            # Test connection
            self.serial_connection.write(b'AT\r')
            time.sleep(1)
            response = self.serial_connection.read(100).decode('utf-8', errors='ignore')

            if 'OK' in response:
                self.connected = True
                logger.info(f"SIM900A connected on {self.port} @ {self.baudrate} baud")
                return True
            else:
                logger.error(f"SIM900A did not respond with OK. Response: {response}")
                return False

        except serial.SerialException as e:
            logger.error(f"Failed to connect to SIM900A: {e}")
            return False
        except Exception as e:
            logger.error(f"Hardware connection error: {e}")
            return False

    def _normalize_phone_number(self, phone_number: str) -> str:
        """Normalize phone number to international format"""
        phone_number = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')

        if phone_number.startswith('0'):
            phone_number = '+63' + phone_number[1:]
        elif phone_number.startswith('63') and not phone_number.startswith('+'):
            phone_number = '+' + phone_number
        elif not phone_number.startswith('+'):
            phone_number = '+63' + phone_number

        return phone_number

    def send_sms(self, phone_number: str, message: str) -> bool:
        """Send SMS via SIM900 using the diagnostic script's working method"""
        if not self.connected:
            logger.error("Cannot send SMS - SIM900A not connected")
            return False

        try:
            normalized_phone = self._normalize_phone_number(phone_number)
            logger.info(f"Sending SMS to {normalized_phone}: {message[:50]}...")

            # Set SMS mode to text (same as diagnostic)
            self.serial_connection.write(b'AT+CMGF=1\r')
            time.sleep(0.5)

            # Set recipient (same as diagnostic)
            self.serial_connection.write(f'AT+CMGS="{normalized_phone}"\r'.encode())
            time.sleep(1)

            # Send message with Ctrl+Z (same as diagnostic)
            self.serial_connection.write(f'{message}\x1A'.encode())
            time.sleep(5)

            # Read response (same as diagnostic)
            response = self.serial_connection.read(200).decode('utf-8', errors='ignore')
            response = response.strip()
            logger.info(f"SIM900A response: {response}")

            # Check for ERROR first
            if 'ERROR' in response:
                logger.error(f"Failed to send SMS to {normalized_phone}: SIM900A returned ERROR")
                return False

            # Success if +CMGS: is present or if OK is present without ERROR
            if '+CMGS:' in response or ('OK' in response and 'ERROR' not in response):
                logger.info(f"SMS sent successfully to {normalized_phone}")
                return True
            else:
                logger.error(f"Failed to send SMS to {normalized_phone}: No confirmation in response")
                return False

        except Exception as e:
            logger.error(f"SMS sending error: {e}")
            return False

    def fetch_pending_sms(self) -> List[Dict]:
        """Fetch pending SMS from Supabase"""
        if not self.supabase:
            logger.warning("Cannot fetch SMS - Supabase not initialized")
            return []

        try:
            # Try both column names for backward compatibility
            try:
                response = self.supabase.table('sms_queue').select('*').in_('status', ['pending', 'failed']).lt('retry_count', 3).order('created_at').limit(self.max_concurrent).execute()
            except:
                response = self.supabase.table('sms_queue').select('*').in_('status', ['pending', 'failed']).lt('attempts', 3).order('created_at').limit(self.max_concurrent).execute()

            if response.data:
                logger.info(f"Fetched {len(response.data)} pending SMS messages (max_concurrent: {self.max_concurrent})")
                return response.data
            else:
                logger.debug("No pending SMS messages")
                return []

        except Exception as e:
            logger.error(f"Failed to fetch pending SMS: {e}")
            return []

    def update_sms_status(self, sms_id: str, status: str, error_message: str = None):
        """Update SMS status in Supabase"""
        if not self.supabase:
            return

        try:
            # Get current attempts (try both column names)
            try:
                current_sms = self.supabase.table('sms_queue').select('retry_count').eq('id', sms_id).execute()
                attempts_col = 'retry_count'
            except:
                current_sms = self.supabase.table('sms_queue').select('attempts').eq('id', sms_id).execute()
                attempts_col = 'attempts'

            if not current_sms.data:
                logger.error(f"SMS {sms_id} not found")
                return

            current_attempts = current_sms.data[0].get(attempts_col, 0)
            new_attempts = current_attempts + 1

            update_data = {
                'status': status,
                attempts_col: new_attempts
            }

            if status == 'sent':
                update_data['sent_at'] = datetime.now().isoformat()

            if error_message:
                update_data['error_message'] = error_message

            # Mark as permanently failed after 3 attempts
            if status == 'failed' and new_attempts >= 3:
                update_data['status'] = 'permanently_failed'
                logger.warning(f"SMS {sms_id} marked as permanently failed after {new_attempts} attempts")

            self.supabase.table('sms_queue').update(update_data).eq('id', sms_id).execute()
            logger.debug(f"Updated SMS {sms_id} status to {status} (attempt {new_attempts})")

        except Exception as e:
            logger.error(f"Failed to update SMS status: {e}")

    def process_queue(self):
        """Process pending SMS messages"""
        pending_sms = self.fetch_pending_sms()

        for sms in pending_sms:
            sms_id = sms['id']
            phone_number = sms['phone_number']
            message = sms['message']
            sms_type = sms['sms_type']

            logger.info(f"Processing SMS {sms_id} ({sms_type})")

            # Send SMS
            success = self.send_sms(phone_number, message)

            # Update status
            if success:
                self.update_sms_status(sms_id, 'sent')
            else:
                self.update_sms_status(sms_id, 'failed', 'Failed to send via SIM900')

            # Small delay between messages
            time.sleep(2)

    def run(self):
        """Main loop"""
        logger.info("Starting SMS queue processor...")

        if not self.supabase:
            logger.error("Cannot start - Supabase not initialized")
            return

        if not self.connected:
            logger.warning("Starting without SIM900 - will fail to send SMS")

        while True:
            try:
                self.process_queue()
                logger.info(f"Sleeping for {self.poll_interval} seconds...")
                time.sleep(self.poll_interval)
            except KeyboardInterrupt:
                logger.info("Shutting down...")
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                time.sleep(self.poll_interval)

    def disconnect(self):
        """Disconnect from hardware"""
        if self.serial_connection:
            self.serial_connection.close()
            self.connected = False
            logger.info("SIM900A disconnected")


def main():
    """Main entry point"""
    print("=" * 70)
    print("📱 SMS Queue Processor - CommuteAI")
    print("=" * 70)
    print()

    processor = SMSQueueProcessor()

    print("Status:")
    print(f"  Supabase: {'Connected' if processor.supabase else 'Not connected'}")
    print(f"  SIM900: {'Connected' if processor.connected else 'Not connected'}")
    print(f"  Poll Interval: {processor.poll_interval} seconds")
    print()

    try:
        processor.run()
    finally:
        processor.disconnect()


if __name__ == "__main__":
    main()
