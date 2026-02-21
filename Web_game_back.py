from flask import Flask, request, jsonify, send_from_directory
import os
import json

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.json")


def ensure_database():
    if not os.path.exists(DB_PATH):
        with open(DB_PATH, "w", encoding="utf-8") as db_file:
            json.dump({"players": {}}, db_file, indent=2)


def load_database():
    ensure_database()
    with open(DB_PATH, "r", encoding="utf-8") as db_file:
        return json.load(db_file)


def save_database(data):
    with open(DB_PATH, "w", encoding="utf-8") as db_file:
        json.dump(data, db_file, indent=2)


@app.route("/")
def serve_index():
    return send_from_directory(BASE_DIR, "Web_game.html")


@app.route("/<path:filename>")
def serve_files(filename):
    return send_from_directory(BASE_DIR, filename)


@app.route("/api/register", methods=["POST"])
def register_player():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()

    if not username:
        return jsonify({"error": "Username is required."}), 400

    data = load_database()
    if username in data["players"]:
        return jsonify({"error": "Username already exists."}), 409

    player = {
        "username": username,
        "level": 1,
        "xp": 0,
        "gold": 1000,
        "wins": 0,
        "losses": 0,
        "unlocked_units": ["riflemen"],
    }

    data["players"][username] = player
    save_database(data)

    return jsonify({"message": "Player registered.", "player": player})


@app.route("/api/login", methods=["POST"])
def login_player():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()

    if not username:
        return jsonify({"error": "Username is required."}), 400

    data = load_database()
    player = data["players"].get(username)
    if not player:
        return jsonify({"error": "Account not found."}), 404

    return jsonify({"message": "Login successful.", "player": player})


@app.route("/api/update-player", methods=["POST"])
def update_player():
    payload = request.get_json(silent=True) or {}
    player = payload.get("player") or {}
    username = (player.get("username") or "").strip()

    if not username:
        return jsonify({"error": "Valid player payload is required."}), 400

    data = load_database()
    if username not in data["players"]:
        return jsonify({"error": "Player does not exist."}), 404

    data["players"][username] = {
        "username": username,
        "level": int(player.get("level", 1)),
        "xp": int(player.get("xp", 0)),
        "gold": int(player.get("gold", 1000)),
        "wins": int(player.get("wins", 0)),
        "losses": int(player.get("losses", 0)),
        "unlocked_units": player.get("unlocked_units", ["riflemen"]),
    }
    save_database(data)

    return jsonify({"message": "Player updated.", "player": data["players"][username]})


if __name__ == "__main__":
    ensure_database()
    app.run(host="0.0.0.0", port=5000, debug=True)
