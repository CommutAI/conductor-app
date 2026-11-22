#!/usr/bin/env python3
"""
SMS Queue Processor for CommuteAI
Polls Supabase for pending SMS messages and sends them via SIM900 / SIM900A GSM module.
Includes robust buffer clearing, verbose AT error reporting, prompt handshaking, and hardware diagnostics.
"""

import os
import sys
import time
import argparse
import logging
from datetime import datetime
from typing import Dict, List, Tuple
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
    """Processes SMS queue from Supabase and sends via SIM900/SIM900A GSM module"""

    def __init__(self):
        self.serial_connection = None
        self.connected = False
        self.supabase = None

        # Configuration
        self.port = os.getenv('SIM900A_PORT', '/dev/ttyUSB0')
        self.baudrate = int(os.getenv('SIM900A_BAUDRATE', '9600'))
        self.smsc_number = os.getenv('SIM900A_SMSC')  # Optional SMSC override (e.g. +639180000101 for Smart)
        self.supabase_url = os.getenv('SUPABASE_URL') or os.getenv('VITE_SUPABASE_URL')
        self.supabase_key = os.getenv('SUPABASE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')
        self.poll_interval = int(os.getenv('SMS_POLL_INTERVAL', '10'))  # seconds
        self.max_concurrent = int(os.getenv('MAX_CONCURRENT_SMS', '5'))

        # Initialize
        self._init_supabase()
        self._connect_hardware()

    def _init_supabase(self):
        """Initialize Supabase client"""
        if not SUPABASE_AVAILABLE:
            logger.warning("Supabase client library not available")
            return

        if not self.supabase_url or not self.supabase_key:
            logger.warning("Supabase credentials not configured (check SUPABASE_URL / VITE_SUPABASE_URL)")
            return

        try:
            self.supabase = create_client(self.supabase_url, self.supabase_key)
            logger.info("Supabase client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase: {e}")

    def _send_command(self, cmd: str, timeout: float = 2.0, wait_prompt: bool = False) -> str:
        """Send an AT command and read response until OK, ERROR, or prompt"""
        if not self.serial_connection:
            return ""

        try:
            self.serial_connection.reset_input_buffer()
            self.serial_connection.write(f'{cmd}\r'.encode())

            start_time = time.time()
            response_buf = ""
            while (time.time() - start_time) < timeout:
                if self.serial_connection.in_waiting > 0:
                    chunk = self.serial_connection.read(self.serial_connection.in_waiting).decode('utf-8', errors='ignore')
                    response_buf += chunk
                    if wait_prompt and '>' in response_buf:
                        break
                    if 'OK' in response_buf or 'ERROR' in response_buf:
                        break
                time.sleep(0.05)

            return response_buf.strip()
        except Exception as e:
            logger.error(f"Error executing command '{cmd}': {e}")
            return ""

    def check_diagnostics(self) -> Dict[str, str]:
        """Query SIM status, signal quality, registration, and carrier"""
        diagnostics = {}
        if not self.connected or not self.serial_connection:
            logger.warning("Cannot check diagnostics: SIM900A not connected")
            return diagnostics

        logger.info("--- SIM900A Diagnostics Check ---")

        # 1. SIM Card status
        cpin = self._send_command('AT+CPIN?', timeout=2)
        diagnostics['sim_pin'] = cpin
        if 'READY' in cpin:
            logger.info("  [SIM Card]     Status: READY")
        else:
            logger.warning(f"  [SIM Card]     Status: NOT READY ({cpin}) - Check SIM insertion or PIN lock")

        # 2. Signal Quality
        csq = self._send_command('AT+CSQ', timeout=2)
        diagnostics['signal'] = csq
        logger.info(f"  [Signal CSQ]   {csq}")

        # 3. Network Registration
        creg = self._send_command('AT+CREG?', timeout=2)
        diagnostics['registration'] = creg
        if '+CREG: 0,1' in creg or '+CREG: 1,1' in creg:
            logger.info("  [Registration] REGISTERED (Home Network)")
        elif '+CREG: 0,5' in creg or '+CREG: 1,5' in creg:
            logger.info("  [Registration] REGISTERED (Roaming)")
        elif '+CREG: 0,2' in creg or '+CREG: 1,2' in creg:
            logger.warning("  [Registration] SEARCHING... (Module is looking for 2G network signal)")
        elif '+CREG: 0,3' in creg or '+CREG: 1,3' in creg:
            logger.error("  [Registration] DENIED by network! (Check SIM balance/activation)")
        else:
            logger.warning(f"  [Registration] Status: {creg}")

        # 4. Operator
        cops = self._send_command('AT+COPS?', timeout=3)
        diagnostics['operator'] = cops
        logger.info(f"  [Operator]     {cops}")

        # 5. Service Center Address (SMSC)
        csca = self._send_command('AT+CSCA?', timeout=2)
        diagnostics['smsc'] = csca
        logger.info(f"  [SMSC]         {csca}")

        logger.info("---------------------------------")
        return diagnostics

    def _connect_hardware(self) -> bool:
        """Connect to and configure SIM900A module"""
        if not SERIAL_AVAILABLE:
            logger.error("Serial library not available")
            return False

        try:
            self.serial_connection = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=3
            )

            # Flush any leftover bytes in the UART FIFO
            self.serial_connection.reset_input_buffer()
            self.serial_connection.reset_output_buffer()

            # Test connection
            response = self._send_command('AT', timeout=2)
            if 'OK' not in response:
                logger.error(f"SIM900A did not respond with OK to AT. Response: {response}")
                return False

            self.connected = True
            logger.info(f"SIM900A connected on {self.port} @ {self.baudrate} baud")

            # Disable command echo (ATE0) so echoed commands don't pollute receive buffers
            self._send_command('ATE0', timeout=1)

            # Enable verbose/descriptive error messages (AT+CMEE=2)
            # Instead of returning generic "ERROR", modem will return "+CMS ERROR: <reason>"
            self._send_command('AT+CMEE=2', timeout=1)

            # Set SMS mode to Text Mode (AT+CMGF=1)
            self._send_command('AT+CMGF=1', timeout=1)

            # Set SMS character set to GSM standard
            self._send_command('AT+CSCS="GSM"', timeout=1)

            # If an explicit SMSC was configured, set it
            if self.smsc_number:
                logger.info(f"Setting SMSC to: {self.smsc_number}")
                self._send_command(f'AT+CSCA="{self.smsc_number}"', timeout=2)

            # Run diagnostics check
            self.check_diagnostics()

            return True

        except serial.SerialException as e:
            logger.error(f"Failed to connect to SIM900A: {e}")
            return False
        except Exception as e:
            logger.error(f"Hardware connection error: {e}")
            return False

    def _normalize_phone_number(self, phone_number: str) -> str:
        """Normalize phone number to international format (+63...)"""
        phone_number = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')

        if phone_number.startswith('0'):
            phone_number = '+63' + phone_number[1:]
        elif phone_number.startswith('63') and not phone_number.startswith('+'):
            phone_number = '+' + phone_number
        elif not phone_number.startswith('+'):
            phone_number = '+63' + phone_number

        return phone_number

    def send_sms(self, phone_number: str, message: str) -> Tuple[bool, str]:
        """
        Send SMS via SIM900 with proper handshake, buffer clearing, and detailed error handling.
        Returns: (success: bool, status_or_error_message: str)
        """
        if not self.connected or not self.serial_connection:
            error_msg = "Cannot send SMS - SIM900A not connected"
            logger.error(error_msg)
            return False, error_msg

        try:
            normalized_phone = self._normalize_phone_number(phone_number)
            logger.info(f"Sending SMS to {normalized_phone}: {message[:50]}...")

            # 1. Flush any stale bytes left in the buffer from prior commands
            self.serial_connection.reset_input_buffer()
            self.serial_connection.reset_output_buffer()

            # 2. Ensure text mode is active
            cmgf_resp = self._send_command('AT+CMGF=1', timeout=1.5)
            if 'ERROR' in cmgf_resp:
                error_msg = f"Failed to set SMS text mode: {cmgf_resp}"
                logger.error(error_msg)
                return False, error_msg

            # 3. Clear buffer before sending CMGS
            self.serial_connection.reset_input_buffer()

            # 4. Send recipient command
            cmgs_cmd = f'AT+CMGS="{normalized_phone}"\r'
            self.serial_connection.write(cmgs_cmd.encode())

            # 5. Wait for the '>' prompt (up to 5 seconds)
            prompt_start = time.time()
            prompt_buf = ""
            prompt_received = False

            while (time.time() - prompt_start) < 5.0:
                if self.serial_connection.in_waiting > 0:
                    chunk = self.serial_connection.read(self.serial_connection.in_waiting).decode('utf-8', errors='ignore')
                    prompt_buf += chunk
                    if '>' in prompt_buf:
                        prompt_received = True
                        break
                    if 'ERROR' in prompt_buf:
                        break
                time.sleep(0.05)

            if not prompt_received:
                error_msg = f"Modem did not return '>' prompt (response: {prompt_buf.strip() or 'timeout'})"
                logger.error(f"Failed to initiate SMS to {normalized_phone}: {error_msg}")
                # Send escape (0x1B) to cancel any half-open command on modem
                self.serial_connection.write(b'\x1B')
                time.sleep(0.5)
                self.serial_connection.reset_input_buffer()
                return False, error_msg

            # 6. Send the message text followed by Ctrl+Z (\x1A)
            # Normalize line endings to avoid sending carriage returns that confuse the modem
            cleaned_message = message.replace('\r\n', '\n').replace('\r', '\n')
            self.serial_connection.write(f'{cleaned_message}\x1A'.encode('utf-8', errors='replace'))

            # 7. Dynamically wait for modem confirmation (cellular transmission can take up to 15s)
            send_start = time.time()
            response_buf = ""
            while (time.time() - send_start) < 15.0:
                if self.serial_connection.in_waiting > 0:
                    chunk = self.serial_connection.read(self.serial_connection.in_waiting).decode('utf-8', errors='ignore')
                    response_buf += chunk
                    if '+CMGS:' in response_buf or 'ERROR' in response_buf:
                        # Allow tiny delay to capture trailing OK or line feeds
                        time.sleep(0.3)
                        if self.serial_connection.in_waiting > 0:
                            response_buf += self.serial_connection.read(self.serial_connection.in_waiting).decode('utf-8', errors='ignore')
                        break
                time.sleep(0.1)

            response_clean = response_buf.strip()
            logger.info(f"SIM900A response: {response_clean}")

            # 8. Check result
            if '+CMGS:' in response_clean:
                logger.info(f"SMS sent successfully to {normalized_phone}")
                return True, "sent"
            elif 'ERROR' in response_clean:
                error_msg = f"SIM900A error: {response_clean}"
                logger.error(f"Failed to send SMS to {normalized_phone}: {error_msg}")
                return False, error_msg
            else:
                error_msg = f"No confirmation received from modem (timeout/empty). Output: {response_clean}"
                logger.error(f"Failed to send SMS to {normalized_phone}: {error_msg}")
                return False, error_msg

        except Exception as e:
            error_msg = f"SMS sending exception: {e}"
            logger.error(error_msg)
            return False, error_msg

    def fetch_pending_sms(self) -> List[Dict]:
        """Fetch pending SMS from Supabase"""
        if not self.supabase:
            logger.warning("Cannot fetch SMS - Supabase not initialized")
            return []

        try:
            # Try both column names for backward compatibility
            try:
                response = self.supabase.table('sms_queue').select('*').in_('status', ['pending', 'failed']).lt('retry_count', 3).order('created_at').limit(self.max_concurrent).execute()
            except Exception:
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
            except Exception:
                current_sms = self.supabase.table('sms_queue').select('attempts').eq('id', sms_id).execute()
                attempts_col = 'attempts'

            if not current_sms.data:
                logger.error(f"SMS {sms_id} not found")
                return

            current_attempts = current_sms.data[0].get(attempts_col, 0) or 0
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
            sms_type = sms.get('sms_type', 'unknown')

            logger.info(f"Processing SMS {sms_id} ({sms_type})")

            # Send SMS
            success, error_or_status = self.send_sms(phone_number, message)

            # Update status
            if success:
                self.update_sms_status(sms_id, 'sent')
            else:
                self.update_sms_status(sms_id, 'failed', error_or_status)

            # Small delay between messages to allow cellular modem transmitter to settle
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
    """Main entry point with CLI diagnostics and test send support"""
    parser = argparse.ArgumentParser(description="CommuteAI SMS Queue Processor & SIM900A Manager")
    parser.add_argument('--status', action='store_true', help="Check SIM900A hardware diagnostics and exit")
    parser.add_argument('--test-sms', type=str, metavar="PHONE_NUMBER", help="Send a test SMS to the specified number and exit")
    parser.add_argument('--message', type=str, default="CommuteAI SIM900A test message", help="Message body for --test-sms")
    args = parser.parse_args()

    print("=" * 70)
    print("📱 SMS Queue Processor - CommuteAI")
    print("=" * 70)
    print()

    processor = SMSQueueProcessor()

    print("Status:")
    print(f"  Supabase: {'Connected' if processor.supabase else 'Not connected'}")
    print(f"  SIM900A:  {'Connected' if processor.connected else 'Not connected'}")
    print(f"  Port:     {processor.port} @ {processor.baudrate} baud")
    print()

    try:
        if args.status:
            processor.check_diagnostics()
            return

        if args.test_sms:
            print(f"Sending test SMS to {args.test_sms}...")
            success, detail = processor.send_sms(args.test_sms, args.message)
            if success:
                print("✅ Test SMS sent successfully!")
            else:
                print(f"❌ Failed to send test SMS: {detail}")
            return

        processor.run()
    finally:
        processor.disconnect()


if __name__ == "__main__":
    main()
