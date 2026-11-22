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

---

# Raspberry Pi SIM900A SMS Queue Processor Setup

The `sms_queue_processor.py` script runs on the Raspberry Pi (or connected host), polls pending SMS messages from Supabase (`sms_queue` table), and sends them via the SIM900A GSM module.

## 1. Hardware Requirements & Power Supply Caution

> [!WARNING]
> **Power Supply Requirement:**
> The SIM900A module consumes up to **2.0A peak current** during RF transmission bursts (when sending an SMS). 
> - **DO NOT** power the SIM900A from the Raspberry Pi's 5V pin or a standard USB-to-UART adapter. It will brown out and abort transmission with `ERROR`.
> - Use an external 5V/2A or 5V/3A DC power supply.
> - Ensure a **common ground (GND)** between the external power supply, SIM900A, and Raspberry Pi / USB-to-UART adapter.
> - Connect the GSM antenna firmly.
> - Ensure the SIM card is activated, has regular prepaid load (or active unli-text promo), and is registered under the SIM Registration Act.

## 2. Testing & Diagnostics CLI

To verify SIM900A hardware, signal, and network registration:

```bash
# 1. Run full hardware & network diagnostics
python3 sms_queue_processor.py --status

# 2. Send a test SMS directly to a phone
python3 sms_queue_processor.py --test-sms +639991146757 --message "Test SMS from CommuteAI SIM900A"
```

Expected diagnostic output:
- `[SIM Card]     Status: READY` (If not ready, check SIM insertion / PIN lock)
- `[Signal CSQ]   +CSQ: 18,0` (Value should be >= 10, not 0,0 or 99,99)
- `[Registration] REGISTERED (Home Network)` (`+CREG: 0,1` or `0,5`)
- `[Operator]     +COPS: ... SMART / GLOBE`
- `[SMSC]         +CSCA: "+639180000101",145`

## 3. Running as a Systemd Service

To keep the SMS processor running continuously in the background on boot:

1. **Create systemd unit file:**
```bash
sudo nano /etc/systemd/system/commutai-sms.service
```

2. **Add configuration:**
```ini
[Unit]
Description=CommuteAI SMS Queue Processor (SIM900A)
After=network.target

[Service]
Type=simple
User=chichi
WorkingDirectory=/home/chichi
ExecStart=/usr/bin/python3 /home/chichi/sms_queue_processor.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. **Enable and start the service:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable commutai-sms.service
sudo systemctl start commutai-sms.service
sudo systemctl status commutai-sms.service
```
