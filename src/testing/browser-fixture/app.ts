import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Deterministic fixture application for browser-agent tests.
 *
 * A real HTTP server on 127.0.0.1 serving a small multi-page product so that
 * Playwright exercises genuine navigation, forms, dialogs, popups, uploads and
 * uploads-blocking — not mocks. The loopback binding is intentional: the
 * navigation policy classifies it CONTROLLED_LOCAL for fixture targets only.
 */

const SHELL_HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;

function nav(current: string): string {
  const link = (href: string, label: string) =>
    `<a href="${href}" data-testid="nav-${label.toLowerCase()}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav aria-label="Primary">${link("/", "Home")}${link("/dashboard", "Dashboard")}${link("/analytics", "Analytics")}${link("/projects", "Projects")}${link("/settings", "Settings")}</nav>`;
}

const HOME = `<!doctype html>
<html lang="en"><head>${SHELL_HEAD}<title>Launchboard Home</title></head>
<body>
${nav("/")}
<main>
<h1>Launchboard</h1>
<p data-testid="home-tagline">Content operations for product teams.</p>
<a href="/dashboard" data-testid="home-to-dashboard">Open dashboard</a>
</main>
</body></html>`;

const DASHBOARD = `<!doctype html>
<html lang="en"><head>${SHELL_HEAD}<title>Launchboard Dashboard</title></head>
<body>
${nav("/dashboard")}
<main>
<h1>Dashboard</h1>
<p data-testid="dashboard-metric">Active projects: 3</p>
<button type="button" id="new-project-button" data-testid="new-project">New Project</button>
<a href="#" data-testid="open-docs" id="open-docs">Open docs</a>
<button type="button" data-testid="delete-all" id="delete-all">Delete All Projects</button>
<ul id="project-list" data-testid="project-list"></ul>
<p data-testid="create-status" role="status"></p>
</main>
<dialog id="new-project-dialog" aria-labelledby="new-project-title" data-testid="new-project-dialog">
  <h2 id="new-project-title">New Project</h2>
  <form data-testid="new-project-form" aria-label="New project">
  <label for="project-name">Project Name</label>
  <input id="project-name" data-testid="project-name-input" type="text" autocomplete="off">
  <label for="project-template">Template</label>
  <select id="project-template" data-testid="project-template-select">
    <option value="blank">Blank</option>
    <option value="blog">Blog</option>
    <option value="campaign">Campaign</option>
  </select>
  <label for="project-public">Make public</label>
  <input id="project-public" data-testid="project-public-checkbox" type="checkbox">
  <button type="button" data-testid="create-project" id="create-project">Create</button>
  <button type="button" data-testid="cancel-project" id="cancel-project">Cancel</button>
  </form>
</dialog>
<script>
document.getElementById("new-project-button").addEventListener("click", function () {
  document.getElementById("new-project-dialog").showModal();
});
document.getElementById("cancel-project").addEventListener("click", function () {
  document.getElementById("new-project-dialog").close();
});
document.getElementById("create-project").addEventListener("click", function () {
  var name = document.getElementById("project-name").value.trim() || "Untitled";
  var template = document.getElementById("project-template").value;
  var isPublic = document.getElementById("project-public").checked;
  var item = document.createElement("li");
  item.setAttribute("data-testid", "project-item");
  item.setAttribute("data-template", template);
  item.setAttribute("data-public", String(isPublic));
  item.textContent = name;
  document.getElementById("project-list").appendChild(item);
  var status = document.querySelector('[data-testid="create-status"]');
  status.textContent = 'Project "' + name + '" created';
  document.getElementById("new-project-dialog").close();
});
document.getElementById("delete-all").addEventListener("click", function () {
  if (!window.confirm("Delete all projects?")) return;
  document.getElementById("project-list").innerHTML = "";
  document.querySelector('[data-testid="create-status"]').textContent = "All projects deleted";
});
document.getElementById("open-docs").addEventListener("click", function (event) {
  event.preventDefault();
  window.open("/settings", "_blank");
});
</script>
</body></html>`;

const ANALYTICS = `<!doctype html>
<html lang="en"><head>${SHELL_HEAD}<title>Launchboard Analytics</title></head>
<body>
${nav("/analytics")}
<main>
<h1>Analytics</h1>
<p data-testid="metric-views">Views: 1234</p>
<p data-testid="metric-signups">Signups: 42</p>
<form data-testid="range-form" aria-label="Range filter">
<label for="start-date">Start date</label>
<input id="start-date" data-testid="start-date" type="date">
<label for="range">Range</label>
<select id="range" data-testid="range-select">
  <option value="7 days">7 days</option>
  <option value="30 days">30 days</option>
</select>
<button type="button" data-testid="apply-range" id="apply-range">Apply</button>
</form>
<p data-testid="range-status" role="status"></p>
</main>
<script>
document.getElementById("apply-range").addEventListener("click", function () {
  document.querySelector('[data-testid="range-status"]').textContent =
    "Range applied: " + document.getElementById("range").value;
});
</script>
</body></html>`;

const PROJECTS = `<!doctype html>
<html lang="en"><head>${SHELL_HEAD}<title>Launchboard Projects</title></head>
<body>
${nav("/projects")}
<main>
<h1>Projects</h1>
<ul data-testid="project-list-page"></ul>
<button type="button" data-testid="create-project-nav" id="create-project-nav">Create Project</button>
<a href="/analytics" data-testid="projects-docs">Docs</a>
</main>
<script>
document.getElementById("create-project-nav").addEventListener("click", function () {
  window.location.href = "/dashboard";
});
</script>
</body></html>`;

const SETTINGS = `<!doctype html>
<html lang="en"><head>${SHELL_HEAD}<title>Launchboard Settings</title></head>
<body>
${nav("/settings")}
<main>
<h1>Settings</h1>
<label for="workspace-name">Workspace Name</label>
<input id="workspace-name" data-testid="workspace-name-input" type="text" autocomplete="off">
<label for="workspace-description">Description</label>
<textarea id="workspace-description" data-testid="workspace-description"></textarea>
<fieldset>
<legend>Theme</legend>
<label for="theme-light">Light</label>
<input id="theme-light" data-testid="theme-light-radio" type="radio" name="theme" value="light" checked>
<label for="theme-dark">Dark</label>
<input id="theme-dark" data-testid="theme-dark-radio" type="radio" name="theme" value="dark">
</fieldset>
<label for="logo-upload">Upload Logo</label>
<input id="logo-upload" data-testid="logo-upload-input" type="file">
<button type="button" data-testid="save-settings" id="save-settings">Save Settings</button>
<p data-testid="settings-status" role="status"></p>
</main>
<script>
document.getElementById("save-settings").addEventListener("click", function () {
  var status = document.querySelector('[data-testid="settings-status"]');
  var file = document.getElementById("logo-upload").files[0];
  status.textContent = file
    ? "Settings saved (logo: " + file.name + ")"
    : "Settings saved";
  document.body.setAttribute("data-theme", document.querySelector('input[name="theme"]:checked').value);
});
</script>
</body></html>`;

export const FIXTURE_PAGES: Record<string, string> = {
  "/": HOME,
  "/dashboard": DASHBOARD,
  "/analytics": ANALYTICS,
  "/projects": PROJECTS,
  "/settings": SETTINGS,
};

export interface FixtureServer {
  /** Base URL, always http://127.0.0.1:<ephemeral port>/ */
  url: string;
  close(): Promise<void>;
}

/**
 * Starts the fixture on an ephemeral loopback port. Callers must treat the
 * resulting origin as CONTROLLED_LOCAL.
 */
export function startFixtureServer(): Promise<FixtureServer> {
  const server = http.createServer((request, response) => {
    const path = (request.url ?? "/").split("?", 1)[0] ?? "/";
    const body = FIXTURE_PAGES[path];
    if (body === undefined) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(body);
  });

  return new Promise<FixtureServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (address === null) {
        server.close();
        reject(new Error("Fixture server did not bind a port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections?.();
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
