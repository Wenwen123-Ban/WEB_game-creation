from flask import Flask, request, jsonify, send_from_directory, session
import os
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "your-secret-key")
app.config["SESSION_PERMANENT"] = True
app.permanent_session_lifetime = timedelta(days=7)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.json")
TRANSACTION_PATH = os.path.join(BASE_DIR, "transaction.json")
MATCHES_PATH = os.path.join(BASE_DIR, "matches.json")
DEVELOPER_USERNAME = "NapoleonDev"
DEVELOPER_PASSWORD = "devpassword123"


def _safe_int(value):
    if isinstance(value, bool):
        raise ValueError("Invalid integer value")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    raise ValueError("Invalid integer value")


def ensure_database():
    if not os.path.exists(DB_PATH):
        with open(DB_PATH, "w", encoding="utf-8") as db_file:
            json.dump({"accounts": {}}, db_file, indent=2)

    with open(DB_PATH, "r", encoding="utf-8") as db_file:
        data = json.load(db_file)

    if "accounts" not in data or not isinstance(data["accounts"], dict):
        data["accounts"] = {}

    if DEVELOPER_USERNAME not in data["accounts"]:
        data["accounts"][DEVELOPER_USERNAME] = {
            "password": generate_password_hash(DEVELOPER_PASSWORD),
            "gold": 999999,
            "xp": 999999,
            "level": 99,
            "wins": 0,
            "losses": 0,
            "total_matches": 0,
            "total_deployed_units": 0,
            "role": "developer",
        }

    with open(DB_PATH, "w", encoding="utf-8") as db_file:
        json.dump(data, db_file, indent=2)


def ensure_transaction_ledger():
    if not os.path.exists(TRANSACTION_PATH):
        with open(TRANSACTION_PATH, "w", encoding="utf-8") as transaction_file:
            json.dump({"transactions": []}, transaction_file, indent=2)

    with open(TRANSACTION_PATH, "r", encoding="utf-8") as transaction_file:
        data = json.load(transaction_file)

    if "transactions" not in data or not isinstance(data["transactions"], list):
        data["transactions"] = []

    with open(TRANSACTION_PATH, "w", encoding="utf-8") as transaction_file:
        json.dump(data, transaction_file, indent=2)


def ensure_matches_file():
    if not os.path.exists(MATCHES_PATH):
        with open(MATCHES_PATH, "w", encoding="utf-8") as matches_file:
            json.dump({"matches": []}, matches_file, indent=2)

    with open(MATCHES_PATH, "r", encoding="utf-8") as matches_file:
        data = json.load(matches_file)

    if "matches" not in data or not isinstance(data["matches"], list):
        data["matches"] = []

    with open(MATCHES_PATH, "w", encoding="utf-8") as matches_file:
        json.dump(data, matches_file, indent=2)


def load_database():
    ensure_database()
    with open(DB_PATH, "r", encoding="utf-8") as db_file:
        return json.load(db_file)


def save_database(data):
    with open(DB_PATH, "w", encoding="utf-8") as db_file:
        json.dump(data, db_file, indent=2)


def load_transactions():
    ensure_transaction_ledger()
    with open(TRANSACTION_PATH, "r", encoding="utf-8") as transaction_file:
        return json.load(transaction_file)


def save_transactions(data):
    with open(TRANSACTION_PATH, "w", encoding="utf-8") as transaction_file:
        json.dump(data, transaction_file, indent=2)


def load_matches():
    ensure_matches_file()
    with open(MATCHES_PATH, "r", encoding="utf-8") as matches_file:
        return json.load(matches_file)


def save_matches(data):
    with open(MATCHES_PATH, "w", encoding="utf-8") as matches_file:
        json.dump(data, matches_file, indent=2)


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def cleanup_expired_lobbies(matches_data):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    retained_matches = []
    for match in matches_data["matches"]:
        if match.get("status") != "waiting":
            retained_matches.append(match)
            continue

        created_at_raw = match.get("created_at")
        if not isinstance(created_at_raw, str):
            retained_matches.append(match)
            continue

        try:
            created_at = datetime.fromisoformat(created_at_raw)
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
        except ValueError:
            retained_matches.append(match)
            continue

        players = match.get("players", [])
        if not isinstance(players, list):
            players = []
        if created_at < cutoff and len(players) <= 1:
            continue

        retained_matches.append(match)

    matches_data["matches"] = retained_matches
    return matches_data


def load_matches_with_cleanup(save_if_changed=False):
    matches_data = load_matches()
    original_count = len(matches_data["matches"])
    cleanup_expired_lobbies(matches_data)
    if save_if_changed and len(matches_data["matches"]) != original_count:
        save_matches(matches_data)
    return matches_data


def normalize_match_response(match):
    return {
        "id": match.get("id"),
        "host": match.get("host"),
        "map": match.get("map"),
        "mode": match.get("mode"),
        "max_players": match.get("max_players", 2),
        "players": match.get("players", []),
        "status": match.get("status"),
        "created_at": match.get("created_at"),
        "game_time": match.get("game_time", 15),
    }


def append_transaction(entry_type, from_user, to_user, amount):
    ledger = load_transactions()
    ledger["transactions"].append(
        {
            "type": entry_type,
            "from": from_user,
            "to": to_user,
            "amount": amount,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    save_transactions(ledger)


def sanitize_player_response(username, account):
    return {
        "username": username,
        "gold": account.get("gold", 0),
        "xp": account.get("xp", 0),
        "level": account.get("level", 1),
        "wins": account.get("wins", 0),
        "losses": account.get("losses", 0),
        "total_matches": account.get("total_matches", 0),
        "total_deployed_units": account.get("total_deployed_units", 0),
        "role": account.get("role", "player"),
        "is_dev": account.get("role", "player") == "developer",
    }


def full_user_response(username, account):
    return {
        "username": username,
        "gold": account.get("gold", 0),
        "xp": account.get("xp", 0),
        "level": account.get("level", 1),
        "wins": account.get("wins", 0),
        "losses": account.get("losses", 0),
        "total_matches": account.get("total_matches", 0),
        "total_units": account.get("total_deployed_units", 0),
        "is_dev": account.get("role", "player") == "developer",
    }


@app.route("/")
def serve_index():
    return send_from_directory(BASE_DIR, "Web_game.html")


@app.route("/<path:filename>")
def serve_files(filename):
    return send_from_directory(BASE_DIR, filename)


@app.route("/api/login", methods=["POST"])
def login_player():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password")

    if not username or not isinstance(password, str):
        return jsonify({"success": False, "error": "Username and password are required."}), 400

    data = load_database()
    account = data["accounts"].get(username)

    if not account or not check_password_hash(account.get("password", ""), password):
        return jsonify({"success": False, "error": "Invalid username or password."}), 401

    session.permanent = True
    session["username"] = username
    return jsonify({"success": True, "player": sanitize_player_response(username, account)})


@app.route("/api/create-account", methods=["POST"])
def create_account():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password")

    if not username or not isinstance(password, str):
        return jsonify({"success": False, "error": "Username and password are required."}), 400

    if len(username) < 3 or len(username) > 24:
        return jsonify({"success": False, "error": "Username must be 3-24 characters."}), 400

    if any(char.isspace() for char in username):
        return jsonify({"success": False, "error": "Username cannot contain spaces."}), 400

    if len(password) < 6:
        return jsonify({"success": False, "error": "Password must be at least 6 characters."}), 400

    data = load_database()
    if username in data["accounts"]:
        return jsonify({"success": False, "error": "Username already exists."}), 409

    data["accounts"][username] = {
        "password": generate_password_hash(password),
        "gold": 1000,
        "xp": 0,
        "level": 1,
        "wins": 0,
        "losses": 0,
        "total_matches": 0,
        "total_deployed_units": 0,
        "role": "player",
    }
    save_database(data)
    session.permanent = True
    session["username"] = username

    return jsonify({"success": True, "message": "Account created.", "player": sanitize_player_response(username, data["accounts"][username])}), 201


@app.route("/get_current_user", methods=["GET"])
@app.route("/api/get_current_user", methods=["GET"])
def get_current_user():
    username = session.get("username")
    if not username:
        return jsonify({"success": False})

    data = load_database()
    account = data["accounts"].get(username)
    if not account:
        session.pop("username", None)
        return jsonify({"success": False})

    return jsonify({"success": True, "user": full_user_response(username, account)})


@app.route("/check_session", methods=["GET"])
def check_session():
    if "username" in session:
        return jsonify({"logged_in": True})
    return jsonify({"logged_in": False})


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"success": True})


@app.route("/api/dev-set-gold", methods=["POST"])
def dev_set_gold():
    payload = request.get_json(silent=True) or {}
    session_username = session.get("username")

    if not session_username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    try:
        amount = _safe_int(payload.get("amount"))
    except ValueError:
        return jsonify({"success": False, "error": "Amount must be a valid integer."}), 400

    if amount < 0:
        return jsonify({"success": False, "error": "Amount cannot be negative."}), 400

    data = load_database()
    account = data["accounts"].get(session_username)

    if not account:
        session.pop("username", None)
        return jsonify({"success": False, "error": "Account not found."}), 404

    if account.get("role") != "developer":
        return jsonify({"success": False, "error": "Forbidden."}), 403

    account["gold"] = amount
    save_database(data)
    append_transaction("dev_set", session_username, session_username, amount)

    return jsonify({"success": True, "updated_gold": amount})


@app.route("/api/dev-send-gold", methods=["POST"])
def dev_send_gold():
    payload = request.get_json(silent=True) or {}
    session_username = session.get("username")
    target_name = (payload.get("to") or "").strip()

    if not session_username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    try:
        amount = _safe_int(payload.get("amount"))
    except ValueError:
        return jsonify({"success": False, "error": "Amount must be a valid integer."}), 400

    if amount <= 0:
        return jsonify({"success": False, "error": "Amount must be greater than zero."}), 400

    data = load_database()
    sender = data["accounts"].get(session_username)
    target = data["accounts"].get(target_name)

    if not sender:
        session.pop("username", None)
        return jsonify({"success": False, "error": "Sender account not found."}), 404

    if sender.get("role") != "developer":
        return jsonify({"success": False, "error": "Forbidden."}), 403

    if not target:
        return jsonify({"success": False, "error": "Target account not found."}), 404

    target["gold"] += amount
    save_database(data)
    append_transaction("dev_send", session_username, target_name, amount)

    return jsonify({"success": True, "target": target_name, "amount": amount, "target_gold": target["gold"], "updated_gold": sender["gold"]})


@app.route("/create_match", methods=["POST"])
def create_match():
    payload = request.get_json(silent=True) or {}
    session_username = session.get("username")

    if not session_username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    host = (payload.get("host") or "").strip()
    match_map = (payload.get("map") or "").strip()
    mode = (payload.get("mode") or "").strip()
    status = (payload.get("status") or "pending").strip() or "pending"

    try:
        players = _safe_int(payload.get("players"))
        time_value = _safe_int(payload.get("time"))
    except ValueError:
        return jsonify({"success": False, "error": "Players and time must be valid integers."}), 400

    if host != session_username:
        return jsonify({"success": False, "error": "Host must match logged-in user."}), 403

    if not match_map or not mode:
        return jsonify({"success": False, "error": "Map and mode are required."}), 400

    if players not in (2, 4):
        return jsonify({"success": False, "error": "Players must be 2 or 4."}), 400

    if time_value <= 0:
        return jsonify({"success": False, "error": "Time must be greater than zero."}), 400

    matches_data = load_matches()
    new_match = {
        "host": host,
        "map": match_map,
        "mode": mode,
        "players": players,
        "time": time_value,
        "status": status,
    }
    matches_data["matches"].append(new_match)
    save_matches(matches_data)

    return jsonify({"success": True, "match": new_match}), 201


@app.route("/api/create-lobby", methods=["POST"])
def create_lobby():
    payload = request.get_json(silent=True) or {}
    username = session.get("username")

    if not username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    map_id = (payload.get("map") or "").strip()
    mode = (payload.get("mode") or "1v1").strip() or "1v1"
    max_players = 4 if mode == "2v2" else 2

    try:
        game_time = _safe_int(payload.get("game_time", 15))
    except ValueError:
        return jsonify({"success": False, "error": "game_time must be an integer."}), 400

    if not map_id:
        return jsonify({"success": False, "error": "Map is required."}), 400

    if game_time <= 0:
        return jsonify({"success": False, "error": "Game time must be greater than zero."}), 400

    matches_data = load_matches_with_cleanup(save_if_changed=True)
    if any(isinstance(match.get("players"), list) and username in match.get("players", []) and match.get("status") in ("waiting", "in_progress") for match in matches_data["matches"]):
        return jsonify({"success": False, "error": "You are already in an active lobby or match."}), 409

    lobby_id = str(uuid4())
    existing_ids = {match.get("id") for match in matches_data["matches"]}
    while lobby_id in existing_ids:
        lobby_id = str(uuid4())

    lobby = {
        "id": lobby_id,
        "host": username,
        "map": map_id,
        "mode": mode,
        "max_players": max_players,
        "players": [username],
        "teams": {username: None},
        "status": "waiting",
        "created_at": utc_now_iso(),
        "game_time": game_time,
    }
    matches_data["matches"].append(lobby)
    save_matches(matches_data)
    return jsonify({"success": True, "lobby": normalize_match_response(lobby)}), 201


@app.route("/api/lobbies", methods=["GET"])
def get_lobbies():
    matches_data = load_matches_with_cleanup(save_if_changed=True)
    waiting = [normalize_match_response(match) for match in matches_data["matches"] if match.get("status") == "waiting"]
    return jsonify({"success": True, "lobbies": waiting})


@app.route("/api/get-lobby/<lobby_id>", methods=["GET"])
def get_lobby(lobby_id):
    matches_data = load_matches_with_cleanup(save_if_changed=True)
    lobby = next((match for match in matches_data["matches"] if match.get("id") == lobby_id), None)
    if not lobby:
        return jsonify({"success": False, "error": "Lobby not found."}), 404
    return jsonify({"success": True, "lobby": normalize_match_response(lobby), "teams": lobby.get("teams", {})})


@app.route("/api/join-lobby", methods=["POST"])
def join_lobby():
    payload = request.get_json(silent=True) or {}
    username = session.get("username")
    lobby_id = (payload.get("id") or "").strip()

    if not username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    if not lobby_id:
        return jsonify({"success": False, "error": "Lobby id is required."}), 400

    matches_data = load_matches_with_cleanup(save_if_changed=True)
    lobby = next((match for match in matches_data["matches"] if match.get("id") == lobby_id), None)
    if not lobby or lobby.get("status") != "waiting":
        return jsonify({"success": False, "error": "Lobby is unavailable."}), 404

    players = lobby.setdefault("players", [])
    if username in players:
        return jsonify({"success": True, "lobby": normalize_match_response(lobby)})

    if len(players) >= lobby.get("max_players", 2):
        return jsonify({"success": False, "error": "Lobby is full."}), 409

    players.append(username)
    lobby.setdefault("teams", {})[username] = None
    save_matches(matches_data)
    return jsonify({"success": True, "lobby": normalize_match_response(lobby)})


@app.route("/api/leave-lobby", methods=["POST"])
def leave_lobby():
    payload = request.get_json(silent=True) or {}
    username = session.get("username")
    lobby_id = (payload.get("id") or "").strip()

    if not username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    matches_data = load_matches_with_cleanup(save_if_changed=True)
    lobby_index = next((idx for idx, match in enumerate(matches_data["matches"]) if match.get("id") == lobby_id), None)
    if lobby_index is None:
        return jsonify({"success": False, "error": "Lobby not found."}), 404

    lobby = matches_data["matches"][lobby_index]
    if username == lobby.get("host"):
        matches_data["matches"].pop(lobby_index)
    else:
        lobby["players"] = [player for player in lobby.get("players", []) if player != username]
        lobby.setdefault("teams", {}).pop(username, None)
    save_matches(matches_data)
    return jsonify({"success": True})


@app.route("/api/set-lobby-team", methods=["POST"])
def set_lobby_team():
    payload = request.get_json(silent=True) or {}
    username = session.get("username")
    lobby_id = (payload.get("id") or "").strip()
    team = (payload.get("team") or "").strip().lower()

    if not username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    if team not in ("blue", "red"):
        return jsonify({"success": False, "error": "Invalid team."}), 400

    matches_data = load_matches_with_cleanup(save_if_changed=True)
    lobby = next((match for match in matches_data["matches"] if match.get("id") == lobby_id), None)
    if not lobby or lobby.get("status") != "waiting":
        return jsonify({"success": False, "error": "Lobby unavailable."}), 404

    players = lobby.get("players", [])
    if username not in players:
        return jsonify({"success": False, "error": "You are not a member of this lobby."}), 403

    slots_per_team = 2 if lobby.get("mode") == "2v2" else 1
    teams = lobby.setdefault("teams", {})
    existing_count = sum(1 for player, assigned in teams.items() if assigned == team and player != username)
    if existing_count >= slots_per_team:
        return jsonify({"success": False, "error": "Team is full."}), 409

    teams[username] = team
    save_matches(matches_data)
    return jsonify({"success": True, "lobby": normalize_match_response(lobby), "teams": teams})


@app.route("/api/start-match", methods=["POST"])
def start_match():
    payload = request.get_json(silent=True) or {}
    username = session.get("username")
    lobby_id = (payload.get("id") or "").strip()

    if not username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    matches_data = load_matches_with_cleanup(save_if_changed=True)
    lobby = next((match for match in matches_data["matches"] if match.get("id") == lobby_id), None)
    if not lobby:
        return jsonify({"success": False, "error": "Lobby not found."}), 404

    if lobby.get("host") != username:
        return jsonify({"success": False, "error": "Only host can start the match."}), 403

    if lobby.get("status") != "waiting":
        return jsonify({"success": False, "error": "Match already started."}), 409

    if len(lobby.get("players", [])) < lobby.get("max_players", 2):
        return jsonify({"success": False, "error": "Not all player slots are filled."}), 409

    lobby["status"] = "in_progress"
    save_matches(matches_data)
    return jsonify({"success": True, "lobby": normalize_match_response(lobby)})


@app.route("/api/check-active-match", methods=["GET"])
def check_active_match():
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "You must be logged in."}), 401

    matches_data = load_matches_with_cleanup(save_if_changed=True)
    for match in matches_data["matches"]:
        players = match.get("players", [])
        if isinstance(players, list) and username in players:
            return jsonify({"success": True, "match": normalize_match_response(match), "teams": match.get("teams", {})})

    return jsonify({"success": True, "match": None})


if __name__ == "__main__":
    ensure_database()
    ensure_transaction_ledger()
    ensure_matches_file()
    app.run(host="0.0.0.0", port=5000, debug=True)
