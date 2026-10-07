import os, sys, time
import urllib.request, urllib.error

endpoint = os.environ.get("STORAGE_ENDPOINT", "http://storage:5000").rstrip("/")
bucket   = os.environ.get("BUCKET", "rfo-media")
url      = endpoint + "/" + bucket

if "verify" in sys.argv:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            if r.status == 200:
                print("verify ok: " + bucket)
    except urllib.error.HTTPError as e:
        print("verify FAILED: bucket missing (HTTP " + str(e.code) + ")")
        sys.exit(1)
    sys.exit(0)

for attempt in range(5):
    try:
        req = urllib.request.Request(url, method="PUT")
        with urllib.request.urlopen(req, timeout=10) as r:
            print("bucket ready: " + bucket + " (status " + str(r.status) + ")")
        print("STORAGE_INIT_DONE")
        sys.exit(0)
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print("bucket already exists: " + bucket)
            print("STORAGE_INIT_DONE")
            sys.exit(0)
        print("retry " + str(attempt + 1) + ": " + str(e))
        time.sleep(2)
    except Exception as e:
        print("retry " + str(attempt + 1) + ": " + str(e))
        time.sleep(2)
print("init failed after retries")
sys.exit(1)