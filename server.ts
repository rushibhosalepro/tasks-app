// Tasks: a small to-do list with due dates.
// State is per browser session (cookie), so parallel visitors and replay runs don't collide.

interface Task {
  id: number;
  title: string;
  due: string; // YYYY-MM-DD
  done: boolean;
}
interface Session {
  tasks: Task[];
  nextId: number;
}

// Every new visitor starts with a few example tasks.
function freshSession(): Session {
  return {
    tasks: [
      { id: 1, title: "Pay rent", due: "2026-11-01", done: false },
      { id: 2, title: "Buy groceries", due: "2026-10-24", done: false },
      { id: 3, title: "Book dentist", due: "2026-10-28", done: false },
      { id: 4, title: "Renew passport", due: "2026-12-15", done: false },
    ],
    nextId: 5,
  };
}

let sessions = new Map<string, Session>();

function getSession(req: Request): { id: string; session: Session; isNew: boolean } {
  const id = req.headers.get("cookie")?.match(/sid=([\w-]+)/)?.[1];
  if (id && sessions.has(id)) return { id, session: sessions.get(id)!, isNew: false };
  const fresh = crypto.randomUUID();
  const session = freshSession();
  sessions.set(fresh, session);
  return { id: fresh, session, isNew: true };
}

// Soonest first, so what's due next is at the top.
const byDue = (tasks: Task[]) => [...tasks].sort((a, b) => a.due.localeCompare(b.due));

const json = (data: unknown, status = 200) => Response.json(data, { status });

async function handle(req: Request, s: Session): Promise<Response> {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /health") return json({ ok: true });
  if (route === "POST /__reset") {
    sessions = new Map();
    return json({ ok: true });
  }

  if (route === "GET /api/tasks") return json(byDue(s.tasks));
  if (route === "POST /api/tasks") {
    const { title, due } = (await req.json()) as { title: string; due: string };
    if (!title?.trim()) return json({ error: "Give the task a title" }, 400);
    s.tasks.push({ id: s.nextId++, title: title.trim(), due: due || new Date().toISOString().slice(0, 10), done: false });
    return json(byDue(s.tasks), 201);
  }
  if (req.method === "PATCH" && url.pathname.startsWith("/api/tasks/")) {
    const id = Number(url.pathname.split("/").pop());
    const task = s.tasks.find((t) => t.id === id);
    if (!task) return json({ error: "No such task" }, 404);
    task.done = !task.done;
    return json(byDue(s.tasks));
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/tasks/")) {
    // The list sends the row's position.
    const position = Number(url.pathname.split("/").pop());
    if (!(position >= 0 && position < s.tasks.length)) return json({ error: "No such task" }, 404);
    s.tasks.splice(position, 1);
    return json(byDue(s.tasks));
  }

  if (req.method === "GET" && url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  return json({ error: "not found" }, 404);
}

export async function fetchHandler(req: Request): Promise<Response> {
  const { id, session, isNew } = getSession(req);
  let res: Response;
  try {
    res = await handle(req, session);
  } catch (err) {
    console.error(err);
    res = json({ error: "Something went wrong" }, 500);
  }
  if (isNew) res.headers.append("set-cookie", `sid=${id}; Path=/; HttpOnly; SameSite=Lax`);
  return res;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tasks</title>
<style>
  :root { --bg:#f6f6fb; --card:#fff; --ink:#1c1c28; --muted:#6c6c80; --accent:#5b4ad6; --line:#e3e3ee; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  header { padding:12px 16px; background:var(--card); border-bottom:1px solid var(--line); font-weight:700; }
  main { max-width:640px; margin:0 auto; padding:16px; }
  form { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  input { font:inherit; padding:8px 10px; border:1px solid var(--line); border-radius:8px; }
  input[name=title] { flex:1; min-width:180px; }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
  button.delete { background:transparent; color:#b4382c; border-color:transparent; }
  ul { list-style:none; padding:0; margin:0; }
  li { display:flex; align-items:center; gap:12px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; margin-bottom:8px; }
  li .title { flex:1; } li.done .title { text-decoration:line-through; color:var(--muted); }
  .due { color:var(--muted); font-size:.9rem; }
</style>
</head>
<body>
<header>✅ Tasks</header>
<main>
<h1>My tasks</h1>
<form id="add">
  <input name="title" placeholder="New task" aria-label="New task">
  <input name="due" type="date" aria-label="Due date">
  <button type="submit">Add</button>
</form>
<ul id="tasks" aria-label="Tasks"></ul>
<p id="message" role="status"></p>
</main>
<script>
const api = (path, opts = {}) => fetch(path, { headers: { "content-type": "application/json" }, ...opts }).then(async r => ({ ok: r.ok, data: await r.json() }));
const fmt = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
function render(tasks) {
  document.getElementById("tasks").innerHTML = tasks.map((t, i) =>
    '<li class="' + (t.done ? "done" : "") + '"><input type="checkbox" data-id="' + t.id + '" aria-label="Done: ' + t.title + '"' + (t.done ? " checked" : "") + '>' +
    '<span class="title">' + t.title + '</span><span class="due">Due ' + fmt(t.due) + '</span>' +
    '<button class="delete" data-pos="' + i + '" aria-label="Delete ' + t.title + '">Delete</button></li>').join("");
}
const msg = text => document.getElementById("message").textContent = text;
api("/api/tasks").then(r => render(r.data));
document.getElementById("add").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const r = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: f.title.value, due: f.due.value }) });
  if (r.ok) { render(r.data); f.reset(); msg("Task added"); } else msg(r.data.error);
});
document.getElementById("tasks").addEventListener("click", async e => {
  const d = e.target.dataset;
  if (d.pos !== undefined) { const r = await api("/api/tasks/" + d.pos, { method: "DELETE" }); render(r.data); msg("Task deleted"); }
  else if (d.id) { const r = await api("/api/tasks/" + d.id, { method: "PATCH" }); render(r.data); }
});
</script>
</body>
</html>`;

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({ port, fetch: fetchHandler });
  console.log(`Tasks running on http://localhost:${port}`);
}
