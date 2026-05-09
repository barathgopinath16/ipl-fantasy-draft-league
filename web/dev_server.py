import http.server
import socketserver
import urllib.request
import json
import os
import ssl
from urllib.parse import urlparse, parse_qs

# SSL context for macOS (disables certificate verification)
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

PORT = 8765
WEB_DIR = os.path.dirname(os.path.abspath(__file__))

class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/proxy'):
            self.handle_proxy()
        else:
            super().do_GET()

    def handle_proxy(self):
        query = parse_qs(urlparse(self.path).query)
        endpoint = query.get('endpoint', [None])[0]
        print(f"📡 [PROXY] Fetching endpoint: {endpoint}")
        
        API_BASE = "https://fantasy.iplt20.com/classic/api"
        API_HEADERS = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
            "entity": "d3tR0!t5m@sh",
            "Referer": "https://fantasy.iplt20.com/classic/stats",
        }

        endpoints = {
            'mixapi': '/live/mixapi?lang=en',
            'fixtures': '/feed/tour-fixtures?lang=en',
            'players': '/feed/gamedayplayers?lang=en',
        }

        if not endpoint or endpoint not in endpoints:
            print(f"❌ [PROXY] Invalid endpoint: {endpoint}")
            self.send_error(400, "Invalid endpoint")
            return

        url = f"{API_BASE}{endpoints[endpoint]}"
        if endpoint == 'players':
            for p in ['tourgamedayId', 'teamgamedayId', 'announcedVersion']:
                val = query.get(p, [None])[0]
                if val: url += f"&{p}={val}"

        try:
            req = urllib.request.Request(url, headers=API_HEADERS)
            with urllib.request.urlopen(req, context=_SSL_CTX) as response:
                data = response.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
                print(f"✅ [PROXY] Success: {len(data)} bytes")
        except Exception as e:
            print(f"💥 [PROXY] Error: {e}")
            self.send_error(500, str(e))

if __name__ == "__main__":
    os.chdir(WEB_DIR)
    with socketserver.TCPServer(("", PORT), DevHandler) as httpd:
        print(f"🚀 IPL Fantasy Dev Server running at http://localhost:{PORT}")
        print(f"⚡ Live API Proxy enabled at /api/proxy")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            httpd.shutdown()
