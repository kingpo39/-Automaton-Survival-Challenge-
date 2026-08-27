

Run test **PS C:\\Users\\soley> Test-NetConnection 127.0.0.1 -Port 9050**





powershell  curl.exe --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip



  make sure your aoutopilot=           Get-ScheduledTask -TaskName "Start Debian WSL for Tor"



python



import requests



proxies = {

&#x20;   "http": "socks5h://127.0.0.1:9050",

&#x20;   "https": "socks5h://127.0.0.1:9050",

}



for url in \[

&#x20;   "https://www.kimi.com/plugins",

&#x20;   "https://icanhazip.com/",

&#x20;   "https://check.torproject.org/api/ip",

]:

&#x20;   print("\\nTesting:", url)

&#x20;   try:

&#x20;       r = requests.get(

&#x20;           url,

&#x20;           proxies=proxies,

&#x20;           timeout=30,

&#x20;           headers={"User-Agent": "Mozilla/5.0"}

&#x20;       )

&#x20;       print("Status:", r.status\_code)

&#x20;       print("Response:", r.text\[:200])

&#x20;   except Exception as e:

&#x20;       print("Error:", e)





for running tor 



tor\_proxies = {

&#x20;   "http": "socks5h://127.0.0.1:9050",

&#x20;   "https": "socks5h://127.0.0.1:9050",

}



requests.get(

&#x20;   url,

&#x20;   proxies=tor\_proxies,

&#x20;   timeout=30

)





windows test Test-NetConnection 127.0.0.1 -Port 9050



HOW ITS WORK



1\. Tor service (WSL)



If you enabled it:



sudo systemctl enable tor@default



then Tor starts automatically when WSL starts.



Check:



sudo systemctl is-enabled tor@default



Should return:



enabled

2\. Windows port forwarding



Your current rule:



127.0.0.1:9050  ->  172.21.142.4:9050



is persistent, but the WSL IP can change after reboot. If it changes, the portproxy breaks.



A more stable setup is to make WSL Tor listen through localhost automatically or create a startup script that updates the portproxy.



Normal internet



No proxy activation needed.



Example:



requests.get("https://api.github.com")



uses your normal ISP connection.



Tor connection



Only applications that explicitly use:



proxies = {

&#x20;   "http": "socks5h://127.0.0.1:9050",

&#x20;   "https": "socks5h://127.0.0.1:9050",

}



go through Tor.



Everything else stays normal.





wsl -d Debian -e sh -c "systemctl is-active tor@default"

wsl -d Debian -e sh -c "journalctl -u tor@default --no-pager -n 30"

curl.exe --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip


curl.exe --socks5-hostname 127.0.0.1:9050 https://api.ipify.org


curl.exe --socks5-hostname 127.0.0.1:9050 https://example.com




AFTER RESTAR 

wsl -d Debian -e sh -c "systemctl is-active tor@default"

curl.exe -v --socks5-hostname 172.21.142.4:9050 https://api.ipify.org



First, check your current WSL state

In PowerShell, run:

wsl -l -v

Then:

wsl -d Debian -e systemctl is-active tor@default

If it says active while the shell is open but stops after you close the shell, we need to configure WSL so systemd/services remain available independently of your terminal.

Recommended setup

Inside Debian:

sudo systemctl enable tor@default
sudo systemctl start tor@default
sudo systemctl status tor@default

Then make sure /etc/wsl.conf contains:

[boot]
systemd=true

From PowerShell:

wsl --shutdown

Then start Debian again:

wsl -d Debian

Check:

systemctl is-enabled tor@default
systemctl is-active tor@default

You want:

enabled
active
One important distinction

Even with systemctl enable, WSL itself can still terminate when it has no running processes depending on how you're launching it. So if you want Tor to stay available after closing every Debian terminal, we should make Windows start/keep the WSL instance alive in the background.

Since you already have a Windows Scheduled Task, we can modify that task so:

Windows boots → WSL starts → systemd starts Tor → Tor stays running → you can close every WSL shell → proxy remains available.