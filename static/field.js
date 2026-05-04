(function () {
    "use strict";

    const SVG_NS = "http://www.w3.org/2000/svg";
    const FIELD_W = 1000;
    const FIELD_H = 467;
    const EZ_DEPTH = 164;

    const svg = document.getElementById("field");
    const isBlended = typeof BLENDED !== "undefined" && BLENDED;

    let offenseDir = "right";
    let showArrows = true;
    let drawState = null; // null | { x1, y1 } — only used for first pass in a point
    let selectedPassId = null;
    let dragging = null; // null | { passObj, end: "origin"|"dest" }

    // Point-based state (match view only)
    let points = [];          // [{ id, seq, passes: [...] }, ...]
    let activePointId = null; // which point is shown on the field
    let blendingPoints = false;

    if (!isBlended) {
        points = INITIAL_POINTS.slice();
        if (points.length > 0) {
            activePointId = points[0].id;
        }
    }

    // For blended tournament view, passes come in flat
    let blendedPasses = [];
    if (isBlended) {
        blendedPasses = INITIAL_PASSES.slice();
    }

    // ---- Draw static field ----

    function drawField() {
        svg.appendChild(doc("rect", { x: 0, y: 0, width: FIELD_W, height: FIELD_H, fill: "#fff" }));
        svg.appendChild(doc("rect", {
            x: 0, y: 0, width: FIELD_W, height: FIELD_H,
            fill: "none", stroke: "#1a1a1a", "stroke-width": 1.5
        }));
        svg.appendChild(doc("line", {
            x1: EZ_DEPTH, y1: 0, x2: EZ_DEPTH, y2: FIELD_H,
            stroke: "#1a1a1a", "stroke-width": 1
        }));
        svg.appendChild(doc("line", {
            x1: FIELD_W - EZ_DEPTH, y1: 0, x2: FIELD_W - EZ_DEPTH, y2: FIELD_H,
            stroke: "#1a1a1a", "stroke-width": 1
        }));
        const midY = FIELD_H / 2;
        const brickLeft = EZ_DEPTH + (FIELD_W - 2 * EZ_DEPTH) / 4;
        const brickRight = FIELD_W - EZ_DEPTH - (FIELD_W - 2 * EZ_DEPTH) / 4;
        [brickLeft, brickRight].forEach(bx => {
            svg.appendChild(doc("line", {
                x1: bx - 6, y1: midY, x2: bx + 6, y2: midY,
                stroke: "#bbb", "stroke-width": 0.8
            }));
            svg.appendChild(doc("line", {
                x1: bx, y1: midY - 6, x2: bx, y2: midY + 6,
                stroke: "#bbb", "stroke-width": 0.8
            }));
        });
    }

    // ---- Direction arrow ----

    function drawDirectionArrow() {
        const existing = document.getElementById("dir-arrow-group");
        if (existing) existing.remove();

        const g = doc("g", { id: "dir-arrow-group" });
        const cy = FIELD_H / 2;
        const arrowLen = 60;
        let ax, bx;
        if (offenseDir === "right") {
            ax = FIELD_W / 2 - arrowLen / 2;
            bx = FIELD_W / 2 + arrowLen / 2;
        } else {
            ax = FIELD_W / 2 + arrowLen / 2;
            bx = FIELD_W / 2 - arrowLen / 2;
        }
        g.appendChild(doc("line", {
            x1: ax, y1: cy - 30, x2: bx, y2: cy - 30,
            stroke: "#bbb", "stroke-width": 1.2
        }));
        const headSize = 7;
        const dir = offenseDir === "right" ? 1 : -1;
        g.appendChild(doc("line", {
            x1: bx, y1: cy - 30, x2: bx - dir * headSize, y2: cy - 30 - headSize,
            stroke: "#bbb", "stroke-width": 1.2
        }));
        g.appendChild(doc("line", {
            x1: bx, y1: cy - 30, x2: bx - dir * headSize, y2: cy - 30 + headSize,
            stroke: "#bbb", "stroke-width": 1.2
        }));
        g.appendChild(doc("text", {
            x: FIELD_W / 2, y: cy - 40,
            "text-anchor": "middle", "font-size": "11", fill: "#bbb",
            "font-family": "Georgia, serif"
        }, "offense"));
        svg.appendChild(g);
    }

    // ---- Pass color logic ----

    function isScore(p) {
        if (p.is_turnover) return false;
        if (p.direction === "right") return p.x2 > FIELD_W - EZ_DEPTH;
        return p.x2 < EZ_DEPTH;
    }

    function passColor(p) {
        if (p.is_turnover) return "#c62828"; // red
        const forward = p.direction === "right" ? p.x2 > p.x1 : p.x2 < p.x1;
        return forward ? "#2e7d32" : "#1565c0"; // green : blue
    }

    // ---- Get current passes to render ----

    function currentPasses() {
        if (isBlended) return blendedPasses;
        if (blendingPoints) {
            let all = [];
            points.forEach(pt => { all = all.concat(pt.passes); });
            return all;
        }
        const pt = points.find(p => p.id === activePointId);
        return pt ? pt.passes : [];
    }

    // ---- Render passes ----

    function renderPasses() {
        svg.querySelectorAll(".pass-group").forEach(el => el.remove());

        currentPasses().forEach(p => {
            const g = doc("g", { class: "pass-group", "data-id": p.id });
            const color = passColor(p);

            if (showArrows) {
                g.appendChild(doc("line", {
                    x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
                    stroke: color, "stroke-width": 1.5, "stroke-opacity": 0.7
                }));

                if (isScore(p)) {
                    // Score: circle at destination
                    g.appendChild(doc("circle", {
                        cx: p.x2, cy: p.y2, r: 6,
                        fill: "none", stroke: color, "stroke-width": 2, "stroke-opacity": 0.85
                    }));
                } else {
                    // Normal: arrowhead at destination
                    const angle = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
                    const hs = 8;
                    const ax1 = p.x2 - hs * Math.cos(angle - Math.PI / 6);
                    const ay1 = p.y2 - hs * Math.sin(angle - Math.PI / 6);
                    const ax2 = p.x2 - hs * Math.cos(angle + Math.PI / 6);
                    const ay2 = p.y2 - hs * Math.sin(angle + Math.PI / 6);
                    g.appendChild(doc("polygon", {
                        points: `${p.x2},${p.y2} ${ax1},${ay1} ${ax2},${ay2}`,
                        fill: color, "fill-opacity": 0.7
                    }));
                }
            }

            // Origin cross
            const cs = 5;
            g.appendChild(doc("line", {
                x1: p.x1 - cs, y1: p.y1 - cs, x2: p.x1 + cs, y2: p.y1 + cs,
                stroke: color, "stroke-width": 2
            }));
            g.appendChild(doc("line", {
                x1: p.x1 + cs, y1: p.y1 - cs, x2: p.x1 - cs, y2: p.y1 + cs,
                stroke: color, "stroke-width": 2
            }));

            // Drag handle: origin
            const originHandle = doc("circle", {
                cx: p.x1, cy: p.y1, r: 12,
                fill: "transparent", stroke: "none", class: "drag-handle",
                style: "cursor:grab"
            });
            g.appendChild(originHandle);

            // Drag handle: destination
            const destHandle = doc("circle", {
                cx: p.x2, cy: p.y2, r: 12,
                fill: "transparent", stroke: "none", class: "drag-handle",
                style: "cursor:grab"
            });
            g.appendChild(destHandle);

            if (!isBlended && !blendingPoints) {
                originHandle.addEventListener("mousedown", function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    dragging = { passObj: p, end: "origin" };
                });
                destHandle.addEventListener("mousedown", function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    dragging = { passObj: p, end: "dest" };
                });
                g.addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (!dragging) selectPass(p);
                });
            }

            svg.appendChild(g);
        });
    }

    // ---- Point tabs ----

    function renderPointTabs() {
        const container = document.getElementById("point-tabs");
        if (!container) return;
        container.innerHTML = "";
        points.forEach(pt => {
            const tab = document.createElement("button");
            tab.className = "point-tab" + (pt.id === activePointId && !blendingPoints ? " active" : "");
            tab.textContent = pt.seq;
            tab.addEventListener("click", function () {
                blendingPoints = false;
                activePointId = pt.id;
                renderPointTabs();
                renderPasses();
            });
            container.appendChild(tab);
        });
    }

    // ---- Pass interaction ----

    function selectPass(p) {
        selectedPassId = p.id;
        const box = document.getElementById("comment-box");
        const txt = document.getElementById("comment-text");
        txt.value = p.comment || "";
        box.classList.remove("hidden");
    }

    function closeComment() {
        selectedPassId = null;
        document.getElementById("comment-box").classList.add("hidden");
    }

    // ---- SVG coordinate helper ----

    function svgPoint(e) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: Math.round(loc.x * 10) / 10, y: Math.round(loc.y * 10) / 10 };
    }

    // ---- Drag to reposition endpoints ----

    if (!isBlended) {
        svg.addEventListener("mousemove", function (e) {
            if (!dragging) return;
            const pt = svgPoint(e);
            const p = dragging.passObj;
            if (dragging.end === "origin") {
                p.x1 = pt.x; p.y1 = pt.y;
            } else {
                p.x2 = pt.x; p.y2 = pt.y;
            }
            renderPasses();
        });

        svg.addEventListener("mouseup", function () {
            if (!dragging) return;
            const p = dragging.passObj;
            dragging = null;
            // Persist new coordinates
            fetch(`/api/pass/${p.id}/coords`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 })
            });
        });

        svg.addEventListener("mouseleave", function () {
            if (!dragging) return;
            const p = dragging.passObj;
            dragging = null;
            fetch(`/api/pass/${p.id}/coords`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 })
            });
        });
    }

    // ---- Click to add pass ----

    function lastPassOfActivePoint() {
        const ptObj = points.find(p => p.id === activePointId);
        if (!ptObj || ptObj.passes.length === 0) return null;
        return ptObj.passes[ptObj.passes.length - 1];
    }

    if (!isBlended) {
        svg.addEventListener("click", function (e) {
            if (e.target.closest(".drag-handle")) return;
            if (e.target.closest(".pass-group")) return;
            if (blendingPoints) return;
            if (!activePointId) return;

            const pt = svgPoint(e);
            const lastPass = lastPassOfActivePoint();

            if (lastPass) {
                // Chain from previous pass destination
                const isTurnover = document.getElementById("toggle-turnover").checked;
                const data = {
                    point_id: activePointId,
                    x1: lastPass.x2, y1: lastPass.y2,
                    x2: pt.x, y2: pt.y,
                    direction: offenseDir,
                    is_turnover: isTurnover ? 1 : 0,
                    comment: ""
                };
                addPass(data);
            } else if (!drawState) {
                // First pass: need origin
                drawState = { x1: pt.x, y1: pt.y };
                const cs = 5;
                const tmp = doc("g", { id: "tmp-origin" });
                tmp.appendChild(doc("line", {
                    x1: pt.x - cs, y1: pt.y - cs, x2: pt.x + cs, y2: pt.y + cs,
                    stroke: "#999", "stroke-width": 2
                }));
                tmp.appendChild(doc("line", {
                    x1: pt.x + cs, y1: pt.y - cs, x2: pt.x - cs, y2: pt.y + cs,
                    stroke: "#999", "stroke-width": 2
                }));
                svg.appendChild(tmp);
            } else {
                // First pass: set destination
                const isTurnover = document.getElementById("toggle-turnover").checked;
                const data = {
                    point_id: activePointId,
                    x1: drawState.x1, y1: drawState.y1,
                    x2: pt.x, y2: pt.y,
                    direction: offenseDir,
                    is_turnover: isTurnover ? 1 : 0,
                    comment: ""
                };
                drawState = null;
                const tmp = document.getElementById("tmp-origin");
                if (tmp) tmp.remove();
                addPass(data);
            }
        });
    }

    function addPass(data) {
        fetch("/api/pass", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(r => r.json())
            .then(res => {
                data.id = res.id;
                data.seq = res.seq;
                const ptObj = points.find(p => p.id === activePointId);
                if (ptObj) ptObj.passes.push(data);
                renderPasses();
                document.getElementById("toggle-turnover").checked = false;
            });
    }

    // ---- Controls ----

    const toggleArrows = document.getElementById("toggle-arrows");
    if (toggleArrows) {
        toggleArrows.addEventListener("change", function () {
            showArrows = this.checked;
            renderPasses();
        });
    }

    const btnDir = document.getElementById("btn-direction");
    function updateDirLabel() {
        if (btnDir) btnDir.innerHTML = offenseDir === "right" ? "Offense &#8594;" : "&#8592; Offense";
    }
    if (btnDir) {
        btnDir.addEventListener("click", function () {
            offenseDir = offenseDir === "right" ? "left" : "right";
            updateDirLabel();
            drawDirectionArrow();
        });
    }

    // Add point
    const btnAddPoint = document.getElementById("btn-add-point");
    if (btnAddPoint) {
        btnAddPoint.addEventListener("click", function () {
            fetch("/api/point", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ match_id: MATCH_ID })
            })
                .then(r => r.json())
                .then(res => {
                    const newPt = { id: res.id, seq: res.seq, passes: [] };
                    points.push(newPt);
                    blendingPoints = false;
                    activePointId = newPt.id;
                    // Auto-flip offense direction
                    offenseDir = offenseDir === "right" ? "left" : "right";
                    updateDirLabel();
                    drawDirectionArrow();
                    renderPointTabs();
                    renderPasses();
                });
        });
    }

    // Delete point
    const btnDeletePoint = document.getElementById("btn-delete-point");
    if (btnDeletePoint) {
        btnDeletePoint.addEventListener("click", function () {
            if (!activePointId) return;
            if (!confirm("Delete this point and all its passes?")) return;
            fetch(`/api/point/${activePointId}`, { method: "DELETE" })
                .then(() => {
                    points = points.filter(p => p.id !== activePointId);
                    activePointId = points.length > 0 ? points[0].id : null;
                    renderPointTabs();
                    renderPasses();
                });
        });
    }

    // Blend all points
    const btnBlend = document.getElementById("btn-blend-points");
    if (btnBlend) {
        btnBlend.addEventListener("click", function () {
            blendingPoints = !blendingPoints;
            btnBlend.textContent = blendingPoints ? "single point" : "blend all";
            renderPointTabs();
            renderPasses();
        });
    }

    // Undo last pass
    const btnUndo = document.getElementById("btn-undo");
    if (btnUndo) {
        btnUndo.addEventListener("click", function () {
            if (!activePointId || blendingPoints) return;
            const ptObj = points.find(p => p.id === activePointId);
            if (!ptObj || ptObj.passes.length === 0) return;
            fetch("/api/pass/undo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ point_id: activePointId })
            })
                .then(r => r.json())
                .then(res => {
                    if (res.deleted_id) {
                        ptObj.passes = ptObj.passes.filter(p => p.id !== res.deleted_id);
                        renderPasses();
                    }
                });
        });
    }

    // Comment box
    const commentSave = document.getElementById("comment-save");
    if (commentSave) {
        commentSave.addEventListener("click", function () {
            if (selectedPassId == null) return;
            const comment = document.getElementById("comment-text").value;
            fetch(`/api/pass/${selectedPassId}/comment`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ comment })
            }).then(() => {
                points.forEach(pt => {
                    const p = pt.passes.find(p => p.id === selectedPassId);
                    if (p) p.comment = comment;
                });
                closeComment();
            });
        });
    }

    const commentDelete = document.getElementById("comment-delete");
    if (commentDelete) {
        commentDelete.addEventListener("click", function () {
            if (selectedPassId == null) return;
            if (!confirm("Delete this pass?")) return;
            fetch(`/api/pass/${selectedPassId}`, { method: "DELETE" })
                .then(() => {
                    points.forEach(pt => {
                        pt.passes = pt.passes.filter(p => p.id !== selectedPassId);
                    });
                    closeComment();
                    renderPasses();
                });
        });
    }

    const commentClose = document.getElementById("comment-close");
    if (commentClose) {
        commentClose.addEventListener("click", closeComment);
    }

    // ---- PDF export ----

    const btnPdf = document.getElementById("btn-export-pdf");
    if (btnPdf) {
        btnPdf.addEventListener("click", function () {
            const clone = svg.cloneNode(true);
            clone.querySelectorAll(".hit-area").forEach(el => el.remove());
            clone.removeAttribute("id");
            const svgData = new XMLSerializer().serializeToString(clone);
            const title = document.querySelector("h1").textContent;
            const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title>
<style>
@page { size: landscape; margin: 1.5cm; }
body { font-family: Georgia, serif; text-align: center; margin: 0; padding: 2rem; }
h1 { font-size: 18px; font-weight: 700; margin-bottom: 0.5rem; }
svg { width: 100%; max-width: 800px; border: 1px solid #1a1a1a; }
</style></head><body>
<h1>${title}</h1>
${svgData}
<script>window.onload=function(){window.print()}<\/script>
</body></html>`;
            const blob = new Blob([html], { type: "text/html" });
            window.open(URL.createObjectURL(blob), "_blank");
        });
    }

    // ---- SVG helper ----

    function doc(tag, attrs, text) {
        const el = document.createElementNS(SVG_NS, tag);
        if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        if (text) el.textContent = text;
        return el;
    }

    // ---- Init ----

    drawField();
    if (!isBlended) {
        drawDirectionArrow();
        renderPointTabs();
    }
    renderPasses();
})();
