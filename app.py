from flask import Flask, render_template, request, redirect, url_for, jsonify
from database import get_db, init_db

app = Flask(__name__)


@app.before_request
def before_request():
    init_db()


# --- Tournament routes ---

@app.route("/")
def index():
    db = get_db()
    tournaments = db.execute(
        "SELECT t.*, COUNT(m.id) AS match_count "
        "FROM tournament t LEFT JOIN match m ON m.tournament_id = t.id "
        "GROUP BY t.id ORDER BY t.created_at DESC"
    ).fetchall()
    db.close()
    return render_template("index.html", tournaments=tournaments)


@app.route("/tournament/new", methods=["POST"])
def tournament_new():
    name = request.form.get("name", "").strip()
    if name:
        db = get_db()
        db.execute("INSERT INTO tournament (name) VALUES (?)", (name,))
        db.commit()
        db.close()
    return redirect(url_for("index"))


@app.route("/tournament/<int:tid>/delete", methods=["POST"])
def tournament_delete(tid):
    db = get_db()
    db.execute("DELETE FROM tournament WHERE id = ?", (tid,))
    db.commit()
    db.close()
    return redirect(url_for("index"))


@app.route("/tournament/<int:tid>")
def tournament(tid):
    db = get_db()
    tournament = db.execute("SELECT * FROM tournament WHERE id = ?", (tid,)).fetchone()
    if not tournament:
        db.close()
        return redirect(url_for("index"))
    matches = db.execute(
        "SELECT m.*, "
        "(SELECT COUNT(*) FROM point WHERE point.match_id = m.id) AS point_count, "
        "(SELECT COUNT(*) FROM pass JOIN point ON pass.point_id = point.id WHERE point.match_id = m.id) AS pass_count "
        "FROM match m WHERE m.tournament_id = ? ORDER BY m.created_at DESC",
        (tid,)
    ).fetchall()
    db.close()
    return render_template("tournament.html", tournament=tournament, matches=matches)


# --- Match routes ---

@app.route("/tournament/<int:tid>/match/new", methods=["POST"])
def match_new(tid):
    opponent = request.form.get("opponent", "").strip()
    if opponent:
        db = get_db()
        db.execute("INSERT INTO match (tournament_id, opponent) VALUES (?, ?)", (tid, opponent))
        db.commit()
        db.close()
    return redirect(url_for("tournament", tid=tid))


@app.route("/match/<int:mid>/delete", methods=["POST"])
def match_delete(mid):
    db = get_db()
    match = db.execute("SELECT tournament_id FROM match WHERE id = ?", (mid,)).fetchone()
    tid = match["tournament_id"] if match else None
    db.execute("DELETE FROM match WHERE id = ?", (mid,))
    db.commit()
    db.close()
    return redirect(url_for("tournament", tid=tid) if tid else url_for("index"))


@app.route("/match/<int:mid>")
def match(mid):
    db = get_db()
    match = db.execute("SELECT * FROM match WHERE id = ?", (mid,)).fetchone()
    if not match:
        db.close()
        return redirect(url_for("index"))
    tournament = db.execute("SELECT * FROM tournament WHERE id = ?",
                            (match["tournament_id"],)).fetchone()
    points = db.execute("SELECT * FROM point WHERE match_id = ? ORDER BY seq", (mid,)).fetchall()
    points_data = []
    for pt in points:
        passes = db.execute("SELECT * FROM pass WHERE point_id = ? ORDER BY seq",
                            (pt["id"],)).fetchall()
        points_data.append({
            "id": pt["id"],
            "seq": pt["seq"],
            "passes": [dict(p) for p in passes]
        })
    db.close()
    return render_template("match.html", match=match, tournament=tournament,
                           points=points_data)


# --- Blended view (tournament level) ---

@app.route("/tournament/<int:tid>/blended")
def tournament_blended(tid):
    db = get_db()
    tournament = db.execute("SELECT * FROM tournament WHERE id = ?", (tid,)).fetchone()
    if not tournament:
        db.close()
        return redirect(url_for("index"))
    passes = db.execute(
        "SELECT p.* FROM pass p "
        "JOIN point pt ON p.point_id = pt.id "
        "JOIN match m ON pt.match_id = m.id "
        "WHERE m.tournament_id = ? ORDER BY p.created_at",
        (tid,)
    ).fetchall()
    matches = db.execute("SELECT * FROM match WHERE tournament_id = ? ORDER BY created_at",
                         (tid,)).fetchall()
    db.close()
    return render_template("blended.html", tournament=tournament,
                           passes=[dict(p) for p in passes], matches=matches)


# --- Point API ---

@app.route("/api/point", methods=["POST"])
def point_add():
    data = request.get_json()
    match_id = data["match_id"]
    db = get_db()
    row = db.execute("SELECT COALESCE(MAX(seq), 0) AS mx FROM point WHERE match_id = ?",
                     (match_id,)).fetchone()
    seq = row["mx"] + 1
    cur = db.execute("INSERT INTO point (match_id, seq) VALUES (?, ?)", (match_id, seq))
    db.commit()
    point_id = cur.lastrowid
    db.close()
    return jsonify({"id": point_id, "seq": seq})


@app.route("/api/point/<int:pid>", methods=["DELETE"])
def point_delete(pid):
    db = get_db()
    db.execute("DELETE FROM point WHERE id = ?", (pid,))
    db.commit()
    db.close()
    return jsonify({"ok": True})


# --- Pass API ---

@app.route("/api/pass", methods=["POST"])
def pass_add():
    data = request.get_json()
    point_id = data["point_id"]
    db = get_db()
    row = db.execute("SELECT COALESCE(MAX(seq), 0) AS mx FROM pass WHERE point_id = ?",
                     (point_id,)).fetchone()
    seq = row["mx"] + 1
    cur = db.execute(
        "INSERT INTO pass (point_id, seq, x1, y1, x2, y2, direction, is_turnover, comment) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (point_id, seq, data["x1"], data["y1"], data["x2"], data["y2"],
         data["direction"], int(data.get("is_turnover", 0)), data.get("comment", ""))
    )
    db.commit()
    pass_id = cur.lastrowid
    db.close()
    return jsonify({"id": pass_id, "seq": seq})


@app.route("/api/pass/<int:pid>", methods=["DELETE"])
def pass_delete(pid):
    db = get_db()
    db.execute("DELETE FROM pass WHERE id = ?", (pid,))
    db.commit()
    db.close()
    return jsonify({"ok": True})


@app.route("/api/pass/<int:pid>/coords", methods=["PUT"])
def pass_update_coords(pid):
    data = request.get_json()
    db = get_db()
    db.execute("UPDATE pass SET x1=?, y1=?, x2=?, y2=? WHERE id=?",
               (data["x1"], data["y1"], data["x2"], data["y2"], pid))
    db.commit()
    db.close()
    return jsonify({"ok": True})


@app.route("/api/pass/<int:pid>/comment", methods=["PUT"])
def pass_update_comment(pid):
    data = request.get_json()
    db = get_db()
    db.execute("UPDATE pass SET comment = ? WHERE id = ?", (data.get("comment", ""), pid))
    db.commit()
    db.close()
    return jsonify({"ok": True})


@app.route("/api/pass/undo", methods=["POST"])
def pass_undo():
    """Delete the most recently added pass within a given point."""
    data = request.get_json()
    point_id = data["point_id"]
    db = get_db()
    last = db.execute(
        "SELECT id FROM pass WHERE point_id = ? ORDER BY seq DESC LIMIT 1",
        (point_id,)
    ).fetchone()
    if last:
        db.execute("DELETE FROM pass WHERE id = ?", (last["id"],))
        db.commit()
    db.close()
    return jsonify({"ok": True, "deleted_id": last["id"] if last else None})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
