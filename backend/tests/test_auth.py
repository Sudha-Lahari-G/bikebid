from app.core.config import Settings, get_settings
from tests.conftest import PASSWORD, auth, register


async def test_register_returns_token_and_user(client):
    token, user = await register(client, "Priya Raman")
    assert token
    assert user["full_name"] == "Priya Raman"
    assert user["role"] == "user"
    assert "password_hash" not in user


async def test_email_is_case_insensitive_and_unique(client):
    body = {"email": "Rider@Example.com", "full_name": "Rider One", "password": PASSWORD}
    assert (await client.post("/api/v1/auth/register", json=body)).status_code == 201

    body["email"] = "rider@example.COM"
    resp = await client.post("/api/v1/auth/register", json=body)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "EMAIL_TAKEN"


async def test_weak_password_is_rejected(client):
    resp = await client.post(
        "/api/v1/auth/register", json={"email": "a@example.com", "full_name": "Al", "password": "short"}
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_login_does_not_reveal_which_emails_exist(client):
    await client.post(
        "/api/v1/auth/register", json={"email": "known@example.com", "full_name": "Known", "password": PASSWORD}
    )
    wrong_password = await client.post(
        "/api/v1/auth/login", json={"email": "known@example.com", "password": "nope-nope-nope"}
    )
    unknown_email = await client.post(
        "/api/v1/auth/login", json={"email": "ghost@example.com", "password": "nope-nope-nope"}
    )
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()


async def test_me_requires_a_valid_token(client):
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    bad = await client.get("/api/v1/auth/me", headers=auth("not-a-jwt"))
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "INVALID_TOKEN"

    token, user = await register(client)
    me = await client.get("/api/v1/auth/me", headers=auth(token))
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]


async def test_login_is_rate_limited(app, client):
    app.dependency_overrides[get_settings] = lambda: Settings(rate_limit_auth_per_minute=3)
    body = {"email": "x@example.com", "password": "whatever-123"}
    codes = [(await client.post("/api/v1/auth/login", json=body)).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401]
    assert codes[3:] == [429, 429]
