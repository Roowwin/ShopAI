import app.core.redis as rfo_redis


async def test_kill_switch_pauses_assistant(client):
    r = rfo_redis.get_redis()
    await r.set("rfo:pubchat:kill", "1")
    resp = await client.post("/store/assistant/chat", json={"message": "hi", "session_id": "testsess01"})
    await r.delete("rfo:pubchat:kill")
    assert resp.status_code == 503


async def test_public_chat_flow_and_scrub(client):
    r = await client.post("/store/assistant/chat",
                          json={"message": "What refurbished phones can I get under $300? My email is a@b.co", "session_id": "testsess01"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "text" in j and "products" in j and "pii_warning" in j
    assert j["pii_warning"] is True


async def test_session_cap_after_six_turns(client):
    import hashlib, json as js
    r = rfo_redis.get_redis()
    hk = hashlib.sha256("testsess01".encode()).hexdigest()[:12]
    await r.set("rfo:pubchat:s:" + hk, js.dumps(["t"] * 6), ex=1800)
    resp = await client.post("/store/assistant/chat", json={"message": "hello", "session_id": "testsess01"})
    await r.delete("rfo:pubchat:s:" + hk)
    assert resp.status_code == 429
