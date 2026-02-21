from flask import Flask, request, jsonify, send_from_directory
import os
import json
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.json")
TRANSACTION_PATH = os.path.join(BASE_DIR, "transaction.json")
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
        "gold": account["gold"],
        "level": account["level"],
        "role": account["role"],
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
        "role": "player",
    }
    save_database(data)

    return jsonify({"success": True, "message": "Account created."}), 201


@app.route("/api/dev-set-gold", methods=["POST"])
def dev_set_gold():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()

    try:
        amount = _safe_int(payload.get("amount"))
    except ValueError:
        return jsonify({"success": False, "error": "Amount must be a valid integer."}), 400

    if amount < 0:
        return jsonify({"success": False, "error": "Amount cannot be negative."}), 400

    data = load_database()
    account = data["accounts"].get(username)

    if not account:
        return jsonify({"success": False, "error": "Account not found."}), 404

    if account.get("role") != "developer":
        return jsonify({"success": False, "error": "Forbidden."}), 403

    account["gold"] = amount
    save_database(data)
    append_transaction("dev_set", username, username, amount)

    return jsonify({"success": True, "gold": amount})


@app.route("/api/dev-send-gold", methods=["POST"])
def dev_send_gold():
    payload = request.get_json(silent=True) or {}
    sender_name = (payload.get("from") or "").strip()
    target_name = (payload.get("to") or "").strip()

    try:
        amount = _safe_int(payload.get("amount"))
    except ValueError:
        return jsonify({"success": False, "error": "Amount must be a valid integer."}), 400

    if amount <= 0:
        return jsonify({"success": False, "error": "Amount must be greater than zero."}), 400

    data = load_database()
    sender = data["accounts"].get(sender_name)
    target = data["accounts"].get(target_name)

    if not sender:
        return jsonify({"success": False, "error": "Sender account not found."}), 404

    if sender.get("role") != "developer":
        return jsonify({"success": False, "error": "Forbidden."}), 403

    if not target:
        return jsonify({"success": False, "error": "Target account not found."}), 404

    target["gold"] += amount
    save_database(data)
    append_transaction("dev_send", sender_name, target_name, amount)

    return jsonify({"success": True, "target": target_name, "amount": amount, "target_gold": target["gold"]})


if __name__ == "__main__":
    ensure_database()
    ensure_transaction_ledger()
    app.run(host="0.0.0.0", port=5000, debug=True)
