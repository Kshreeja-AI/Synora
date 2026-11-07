"""Synora Kaggle environment audit. Prints hardware only; reads no secrets."""
import json, os, platform, shutil, subprocess, sys, time

def run(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60).stdout.strip()
    except Exception as e:  # report, never hide
        return f"ERROR: {e}"

info = {
    "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "python": sys.version.split()[0],
    "platform": platform.platform(),
    "cpu_count": os.cpu_count(),
    "gpu": run("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader"),
    "ram_gb": round(int(run("awk '/MemTotal/{print $2}' /proc/meminfo") or 0) / 1048576, 1),
    "disk_working_free_gb": round(shutil.disk_usage("/kaggle/working").free / 1e9, 1),
}
try:
    import torch
    info["torch"] = torch.__version__
    info["cuda_available"] = torch.cuda.is_available()
except Exception as e:
    info["torch"] = f"not importable: {e}"
try:
    import urllib.request
    urllib.request.urlopen("https://huggingface.co", timeout=10)
    info["internet_huggingface"] = True
except Exception as e:
    info["internet_huggingface"] = f"no: {e}"

os.makedirs("/kaggle/working/outputs", exist_ok=True)
with open("/kaggle/working/outputs/env_audit.json", "w") as f:
    json.dump(info, f, indent=2)
print(json.dumps(info, indent=2))
