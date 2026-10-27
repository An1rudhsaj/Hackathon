"""Acceptance check for the live stream.  Start the server first, then:  python examples/ws_client.py [http://localhost:8000]
Starts the simulator, joins the match room, and prints message rates for 15 s."""
import asyncio
import collections
import sys
import time
import httpx
import socketio

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"


async def main():
    async with httpx.AsyncClient(base_url=BASE) as http:
        tok = (await http.post("/auth/token", json={"scope": "admin"}, headers={"X-API-Key": ""})).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        await http.post("/simulator/demo1/start", headers=h)
    sio = socketio.AsyncClient()
    n, last_seq, first = collections.Counter(), {}, []

    def handler(name):
        async def f(msg):
            n[name] += 1
            if not first: first.append(name)
            if isinstance(msg, dict) and "seq" in msg and isinstance(msg["seq"], int):
                assert msg["seq"] > last_seq.get(name, 0), f"stale seq on {name}"; last_seq[name] = msg["seq"]
        return f
    for name in ("snapshot", "tracking", "events", "analytics", "commentary", "source"):
        sio.on(name, handler(name), namespace="/live")
    await sio.connect(BASE, namespaces=["/live"], auth={"token": tok}, socketio_path="socket.io")
    print("join ->", await sio.call("join", {"matchId": "demo1"}, namespace="/live"))
    t0 = time.time(); await asyncio.sleep(15)
    dt = time.time() - t0
    print("first message:", first[0], "(must be snapshot)")
    for k, v in n.items(): print(f"{k:11s} {v:5d}  ({v / dt:.1f}/s)")
    await sio.disconnect()
    async with httpx.AsyncClient(base_url=BASE) as http:
        await http.post("/simulator/demo1/stop", headers=h)

asyncio.run(main())
