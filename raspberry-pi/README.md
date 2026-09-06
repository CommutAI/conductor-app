# Raspberry Pi GPS Server Setup

This GPS server provides accurate location data from the Raspberry Pi GPS module to the CommutAI Conductor App.

## Prerequisites

- Raspberry Pi with GPS module connected to `/dev/ttyAMA0`
- Python 3 installed
- Internet connection for initial setup

## Installation

1. **Install required Python packages:**
```bash
ssh chichi@commutai.local
sudo apt update
sudo apt install python3-pip python3-flask python3-flask-cors python3-serial
pip3 install flask flask-cors pyserial
```

2. **Enable serial port on Raspberry Pi:**
```bash
sudo raspi-config
# Navigate to Interface Options -> Serial Port
# Enable serial port hardware but disable serial console
```

3. **Copy the GPS server script:**
```bash
# Copy gps_server.py to your Raspberry Pi
scp raspberry-pi/gps_server.py chichi@commutai.local:~/gps_server.py
```

4. **Test the GPS module:**
```bash
# Test GPS communication
python3 -c "import serial; ser = serial.Serial('/dev/ttyAMA0', 9600); ser.write(b'AT\r'); print(ser.read(100).decode())"
```

5. **Run the GPS server:**
```bash
python3 ~/gps_server.py
```

## Setup as System Service

To run the GPS server automatically on boot:

1. **Create systemd service file:**
```bash
sudo nano /etc/systemd/system/commutai-gps.service
```

2. **Add the following content:**
```ini
[Unit]
Description=CommutAI GPS Server
After=network.target

[Service]
Type=simple
User=chichi
WorkingDirectory=/home/chichi
ExecStart=/usr/bin/python3 /home/chichi/gps_server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. **Enable and start the service:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable commutai-gps.service
sudo systemctl start commutai-gps.service
sudo systemctl status commutai-gps.service
```

## API Endpoints

### Get GPS Position
```
GET http://commutai.local:5000/api/gps
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "lat": 8.4542,
    "lng": 124.6315,
    "altitude": 45.2,
    "speed": 0.0,
    "heading": 0.0,
    "satellites": 8,
    "accuracy": 10,
    "timestamp": 1633072800.123
  }
}
```

**Response (No GPS Fix):**
```json
{
  "success": false,
  "error": "No GPS fix available"
}
```

### Health Check
```
GET http://commutai.local:5000/api/health
```

**Response:**
```json
{
  "status": "healthy",
  "gps_connected": true
}
```

## GPS Module Configuration

The server expects GPS data in NMEA format via serial port `/dev/ttyAMA0` at 9600 baud.

Supported NMEA sentences:
- `$GPGGA` or `$GNGGA` - Position and fix data
- `$GPRMC` or `$GNRMC` - Recommended minimum data

## Troubleshooting

### GPS not detected
```bash
# Check if serial port exists
ls -l /dev/ttyAMA0

# Check GPS communication
sudo cat /dev/ttyAMA0
```

### Permission denied
```bash
# Add user to dialout group
sudo usermod -a -G dialout chichi
```

### No GPS fix
- Ensure GPS module has clear view of sky
- Wait 2-5 minutes for initial satellite acquisition
- Check GPS module LED indicator (if available)

### Server not accessible
```bash
# Check if server is running
sudo systemctl status commutai-gps.service

# Check if port 5000 is open
sudo netstat -tlnp | grep 5000

# Test from app machine
curl http://commutai.local:5000/api/health
```

## Integration with App

The app automatically tries to use Raspberry Pi GPS first, then falls back to mobile GPS if unavailable. 

**GPS Service Priority:**
1. Raspberry Pi GPS (http://commutai.local:5000/api/gps)
2. Mobile GPS (Capacitor Geolocation API)

**Benefits of Pi GPS:**
- More accurate and consistent location
- Works even if conductor's phone GPS is unavailable
- Better for continuous tracking
- Higher accuracy for emergency alerts

## Configuration

To change the GPS server endpoint in the app, modify `src/services/gpsService.ts`:

```typescript
private piEndpoint: string = 'http://your-pi-ip:5000/api/gps';
```

To disable Pi GPS and use only mobile GPS:

```typescript
gpsService.setUsePiGPS(false);
```