const statusLabels = {
  assigned: "assigned",
  blocked: "blocked",
  preferred: "preferred",
  reserved: "reserved"
};

function byId(id) {
  return document.getElementById(id);
}

function runtimeFor(port, data) {
  return (data.runtime || []).find((entry) => Number(entry.port) === Number(port));
}

function linkFor(entry) {
  if (!entry.url) {
    return "";
  }

  return `<a href="${entry.url}">${entry.url.replace(/^https?:\/\//, "")}</a>`;
}

function render(data) {
  const entries = [...(data.entries || [])].sort((a, b) => Number(a.port) - Number(b.port));
  const ranges = data.ranges || [];
  const reserved = entries.filter((entry) => entry.status === "reserved").length;
  const listening = (data.runtime || []).filter((entry) => entry.runtime === "listening").length;

  byId("registry-count").textContent = `${entries.length} entries`;
  byId("registry-updated").textContent = data.exportedAt
    ? `Exported ${new Date(data.exportedAt).toLocaleString()}`
    : `Updated ${data.updatedAt || "unknown"}`;
  byId("metric-entries").textContent = String(entries.length);
  byId("metric-ranges").textContent = String(ranges.length);
  byId("metric-reserved").textContent = String(reserved);
  byId("metric-listening").textContent = String(listening);

  const body = byId("ports-body");
  body.innerHTML = entries
    .map((entry) => {
      const runtime = runtimeFor(entry.port, data);
      const runtimeLabel = runtime?.runtime || "unknown";

      return `<tr>
        <td><code>${entry.port}</code></td>
        <td><span class="badge status-${entry.status}">${statusLabels[entry.status] || entry.status}</span></td>
        <td>${entry.project || ""}</td>
        <td>${entry.service || ""}</td>
        <td>${entry.type || ""}</td>
        <td><span class="runtime-${runtimeLabel}">${runtimeLabel}</span></td>
        <td>${linkFor(entry)}</td>
      </tr>`;
    })
    .join("");
  byId("ports-empty").hidden = entries.length > 0;

  byId("ranges").innerHTML = ranges
    .map(
      (range) => `<article class="range-card">
        <div><strong>${range.label}</strong><code>${range.start}-${range.end}</code></div>
        <p>${range.description}</p>
      </article>`
    )
    .join("");
}

fetch("./ports.json")
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ports.json (${response.status})`);
    }
    return response.json();
  })
  .then(render)
  .catch((error) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<main class="shell"><section class="panel"><h2>Unable to load ports.json</h2><p class="empty">${error.message}</p></section></main>`
    );
  });
