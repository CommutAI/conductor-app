#!/usr/bin/env python3
"""
Raspberry Pi GPS Server
Provides GPS data via HTTP endpoint for the CommutAI Conductor App
"""

import serial
import json
import time
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# GPS Configuration
GPS_PORT = '/dev/ttyAMA0'  # Serial port for GPS module
GPS_BAUDRATE = 9600
gps_serial = None

def init_gps():
    """Initialize GPS serial connection"""
    global gps_serial
    try:
        gps_serial = serial.Serial(GPS_PORT, GPS_BAUDRATE, timeout=1)
        print(f"GPS initialized on {GPS_PORT}")
        return True
    except Exception as e:
        print(f"Failed to initialize GPS: {e}")
        return False

def parse_nmea_sentence(sentence):
    """Parse NMEA sentence to extract GPS data"""
    try:
        if sentence.startswith('$GPGGA') or sentence.startswith('$GNGGA'):
            # GPGGA - Global Positioning System Fix Data
            parts = sentence.split(',')
            if len(parts) >= 10:
                # Parse time
                time_str = parts[1]
                # Parse latitude
                lat_str = parts[2]
                lat_dir = parts[3]
                # Parse longitude
                lon_str = parts[4]
                lon_dir = parts[5]
                # Parse fix quality
                fix_quality = parts[6]
                # Parse number of satellites
                satellites = parts[7]
                # Parse HDOP
                hdop = parts[8]
                # Parse altitude
                altitude = parts[9]
                # Parse altitude units
                alt_units = parts[10]

                if fix_quality == '0':
                    return None  # No fix

                # Convert latitude from DDMM.MMMM to DD.DDDDDD
                if lat_str:
                    lat_deg = float(lat_str[:2])
                    lat_min = float(lat_str[2:])
                    lat = lat_deg + (lat_min / 60)
                    if lat_dir == 'S':
                        lat = -lat
                else:
                    lat = None

                # Convert longitude from DDDMM.MMMM to DDD.DDDDDD
                if lon_str:
                    lon_deg = float(lon_str[:3])
                    lon_min = float(lon_str[3:])
                    lon = lon_deg + (lon_min / 60)
                    if lon_dir == 'W':
                        lon = -lon
                else:
                    lon = None

                return {
                    'lat': lat,
                    'lng': lon,
                    'altitude': float(altitude) if altitude else None,
                    'satellites': int(satellites) if satellites else None,
                    'fix_quality': int(fix_quality),
                    'hdop': float(hdop) if hdop else None,
                    'timestamp': time.time()
                }

        elif sentence.startswith('$GPRMC') or sentence.startswith('$GNRMC'):
            # GPRMC - Recommended Minimum sentence
            parts = sentence.split(',')
            if len(parts) >= 12:
                # Parse speed (knots)
                speed_knots = parts[7]
                # Parse heading (degrees)
                heading = parts[8]

                return {
                    'speed': float(speed_knots) * 1.852 if speed_knots else None,  # Convert to km/h
                    'heading': float(heading) if heading else None,
                    'timestamp': time.time()
                }

    except Exception as e:
        print(f"Error parsing NMEA sentence: {e}")
        return None

def get_gps_data():
    """Get current GPS data"""
    if not gps_serial:
        if not init_gps():
            return None

    try:
        # Read GPS data for 2 seconds
        start_time = time.time()
        gps_data = {}
        
        while time.time() - start_time < 2:
            if gps_serial.in_waiting > 0:
                sentence = gps_serial.readline().decode('ascii', errors='ignore').strip()
                if sentence:
                    parsed = parse_nmea_sentence(sentence)
                    if parsed:
                        gps_data.update(parsed)
                        # If we have both position and movement data, we're done
                        if 'lat' in gps_data and 'lng' in gps_data and 'speed' in gps_data:
                            break

        # Return None if no GPS fix
        if 'lat' not in gps_data or 'lng' not in gps_data:
            return None

        # Calculate accuracy based on HDOP and satellites
        if 'hdop' in gps_data and 'satellites' in gps_data:
            # Simple accuracy estimation
            hdop = gps_data['hdop']
            satellites = gps_data['satellites']
            if satellites >= 6 and hdop < 2:
                gps_data['accuracy'] = 10  # Good accuracy (10m)
            elif satellites >= 4 and hdop < 4:
                gps_data['accuracy'] = 25  # Moderate accuracy (25m)
            else:
                gps_data['accuracy'] = 50  # Poor accuracy (50m)

        return gps_data

    except Exception as e:
        print(f"Error reading GPS data: {e}")
        return None

@app.route('/api/gps', methods=['GET'])
def get_gps():
    """API endpoint to get current GPS position"""
    gps_data = get_gps_data()
    
    if gps_data:
        return jsonify({
            'success': True,
            'data': gps_data
        })
    else:
        return jsonify({
            'success': False,
            'error': 'No GPS fix available'
        }), 503

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'gps_connected': gps_serial is not None and gps_serial.is_open
    })

if __name__ == '__main__':
    print("Starting CommutAI GPS Server...")
    init_gps()
    app.run(host='0.0.0.0', port=5000, debug=False)