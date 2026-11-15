(() => {
  "use strict";

  const DB_NAME = "BuildBoardDB";
  const DB_VERSION = 1;
  const STORES = ["projects", "tasks", "notes"];
  let db;
  let editing = null;

  const $ = (id) => document.getElementById(id);
  const form = $("entryForm");
  const typeInput = $("type");
  const projectField = $("projectField");
  const projectInput = $("projectId");
  const statusField = $("taskStatusField");
  const statusInput = $("taskStatus");
  const titleInput = $("title");
  const descriptionInput = $("description");
  const entriesEl = $("entries");
  const messageEl = $("message");

  function id() {
    return crypto.randomUUID ? crypto.randomUUID() :
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const storeName of STORES) {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName, { keyPath: "id" });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other BuildBoard tabs and reload."));
    });
  }

  function transaction(storeNames, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      let result;
      try { result = work(tx); }
      catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("Database transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("Database transaction was cancelled."));
    });
  }

  function getAll(storeName) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function put(storeName, record) {
    return transaction([storeName], "readwrite", tx => tx.objectStore(storeName).put(record));
  }

  // Update an existing record without creating a second entry.
  // The IndexedDB database version, stores and key paths stay unchanged.
  function updateRecord(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.get(record.id);
      let updatedRecord;

      request.onsuccess = () => {
        if (!request.result) {
          tx.abort();
          reject(new Error("This item no longer exists. Refresh and try again."));
          return;
        }
        updatedRecord = {
          ...request.result,
          ...record,
          id: request.result.id,
          createdAt: request.result.createdAt,
          updatedAt: Date.now()
        };
        store.put(updatedRecord);
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(updatedRecord);
      tx.onerror = () => reject(tx.error || new Error("Could not update this item."));
      tx.onabort = () => reject(tx.error || new Error("Update was cancelled."));
    });
  }

  function remove(storeName, recordId) {
    return transaction([storeName], "readwrite", tx => tx.objectStore(storeName).delete(recordId));
  }

  function showMessage(text, isError = false) {
    messageEl.textContent = text;
    messageEl.style.color = isError ? "#fca5a5" : "#86efac";
  }

  function safeText(tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function updateFormFields() {
    const type = typeInput.value;
    projectField.classList.toggle("hidden", type === "project");
    statusField.classList.remove("hidden");
  }

  function normalizedStatus(status) {
    if (status === "done") return "completed";
    if (status === "open" || !status) return "planned";
    return ["planned", "in-progress", "completed"].includes(status)
      ? status : "planned";
  }

  function statusLabel(status) {
    return ({
      planned: "Planned",
      "in-progress": "In progress",
      completed: "Completed"
    })[normalizedStatus(status)];
  }

  async function refreshProjectOptions(selected = "") {
    const projects = await getAll("projects");
    projectInput.replaceChildren(new Option("No project", ""));
    projects.sort((a, b) => a.title.localeCompare(b.title));
    for (const project of projects) {
      projectInput.add(new Option(project.title, project.id));
    }
    projectInput.value = selected;
  }

  function resetForm() {
    editing = null;
    form.reset();
    $("formHeading").textContent = "Add to your workspace";
    $("saveButton").textContent = "＋ Add item";
    $("cancelEdit").classList.add("hidden");
    updateFormFields();
    refreshProjectOptions();
  }

  function beginEdit(record) {
    editing = { type: record.type, id: record.id };
    typeInput.value = record.type;
    titleInput.value = record.title;
    descriptionInput.value = record.description || "";
    statusInput.value = normalizedStatus(record.status);
    $("formHeading").textContent = `Edit ${record.type}`;
    $("saveButton").textContent = "Save changes";
    $("cancelEdit").classList.remove("hidden");
    updateFormFields();
    refreshProjectOptions(record.projectId || "");
    $("title").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteRecord(type, record) {
    const label = type === "project" ? "project" : type;
    if (!confirm(`Delete this ${label}: "${record.title}"?`)) return;

    if (type === "project") {
      const [tasks, notes] = await Promise.all([getAll("tasks"), getAll("notes")]);
      const linkedTasks = tasks.filter(x => x.projectId === record.id);
      const linkedNotes = notes.filter(x => x.projectId === record.id);
      const detail = linkedTasks.length + linkedNotes.length
        ? ` This will also delete ${linkedTasks.length} linked task(s) and ${linkedNotes.length} linked note(s).`
        : "";
      if (detail && !confirm(`Continue?${detail}`)) return;
      await transaction(STORES, "readwrite", tx => {
        tx.objectStore("projects").delete(record.id);
        linkedTasks.forEach(x => tx.objectStore("tasks").delete(x.id));
        linkedNotes.forEach(x => tx.objectStore("notes").delete(x.id));
      });
    } else {
      await remove(type === "task" ? "tasks" : "notes", record.id);
    }
    showMessage(`${label[0].toUpperCase()}${label.slice(1)} deleted.`);
    await render();
  }

  async function render() {
    const [projects, tasks, notes] = await Promise.all([
      getAll("projects"), getAll("tasks"), getAll("notes")
    ]);
    const all = [
      ...projects.map(x => ({ ...x, type: "project" })),
      ...tasks.map(x => ({ ...x, type: "task" })),
      ...notes.map(x => ({ ...x, type: "note" }))
    ];
    const projectMap = new Map(projects.map(p => [p.id, p.title]));
    const doneTasks = tasks.filter(t => normalizedStatus(t.status) === "completed").length;
    const completedEntries = [...projects, ...tasks, ...notes]
      .filter(item => normalizedStatus(item.status) === "completed").length;
    $("projectCount").textContent = projects.length;
    $("openTaskCount").textContent = tasks.length - doneTasks;
    $("doneTaskCount").textContent = completedEntries;

    const query = $("search").value.trim().toLowerCase();
    const typeFilter = $("filterType").value;
    const statusFilter = $("filterStatus").value;
    const filtered = all.filter(item => {
      const matchesText = `${item.title} ${item.description || ""} ${projectMap.get(item.projectId) || ""}`.toLowerCase().includes(query);
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      const matchesStatus = statusFilter === "all" ||
        normalizedStatus(item.status) === statusFilter;
      return matchesText && matchesType && matchesStatus;
    }).sort((a, b) => b.updatedAt - a.updatedAt);

    $("itemCount").textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;
    entriesEl.replaceChildren();

    if (!filtered.length) {
      entriesEl.appendChild(safeText("p",
        all.length ? "No items match your search or filters." : "Your workspace is empty. Add your first project!",
        "empty-state"));
      return;
    }

    for (const item of filtered) {
      const card = safeText("article", "", "entry");
      const main = document.createElement("div");
      const top = safeText("div", "", "entry-top");
      top.appendChild(safeText("span", item.type, "tag"));
      const currentStatus = normalizedStatus(item.status);
      top.appendChild(safeText("span", statusLabel(currentStatus),
        currentStatus === "completed" ? "tag done" : "tag"));
      main.appendChild(top);
      main.appendChild(safeText("h3", item.title));
      if (item.description) main.appendChild(safeText("p", item.description));
      const related = item.projectId ? projectMap.get(item.projectId) : "";
      if (related) main.appendChild(safeText("div", `Project: ${related}`, "entry-meta"));
      if (item.type === "project") {
        const projectTasks = tasks.filter(t => t.projectId === item.id);
        const completed = projectTasks.filter(t => normalizedStatus(t.status) === "completed").length;
        const percent = projectTasks.length ? Math.round(completed / projectTasks.length * 100) : 0;
        main.appendChild(safeText("div",
          `${completed} of ${projectTasks.length} tasks completed · ${percent}%`,
          "entry-meta"));
        const bar = document.createElement("div");
        bar.className = "progress";
        const fill = document.createElement("span");
        fill.style.width = `${percent}%`;
        bar.appendChild(fill);
        main.appendChild(bar);
      }
      const actions = safeText("div", "", "entry-actions");
      const edit = safeText("button", "Edit", "small-button");
      edit.type = "button";
      edit.addEventListener("click", () => beginEdit(item));
      const del = safeText("button", "Delete", "small-button delete-button");
      del.type = "button";
      del.addEventListener("click", () => deleteRecord(item.type, item));
      actions.append(edit, del);
      card.append(main, actions);
      entriesEl.appendChild(card);
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const type = typeInput.value;
    const title = titleInput.value.trim();
    if (!title) return showMessage("Please enter a title.", true);

    const wasEditing = Boolean(editing);
    const previousType = editing?.type || null;
    const recordId = editing?.id || id();
    const now = Date.now();
    const record = {
      id: recordId,
      title,
      description: descriptionInput.value.trim(),
      status: statusInput.value,
      updatedAt: now
    };

    const newStore = type === "project" ? "projects" :
      type === "task" ? "tasks" : "notes";
    const oldStore = previousType === "project" ? "projects" :
      previousType === "task" ? "tasks" :
      previousType === "note" ? "notes" : null;

    if (type !== "project") record.projectId = projectInput.value || "";

    try {
      if (wasEditing && oldStore === newStore) {
        await updateRecord(newStore, record);
      } else if (wasEditing) {
        // Changing the entry type moves the same ID instead of duplicating it.
        await transaction([oldStore, newStore], "readwrite", tx => {
          tx.objectStore(oldStore).delete(recordId);
          tx.objectStore(newStore).put({
            ...record,
            createdAt: now
          });
        });
      } else {
        record.createdAt = now;
        await put(newStore, record);
      }

      resetForm();
      await render();
      showMessage(wasEditing ? "Changes updated successfully." : "Added to your workspace.");
    } catch (error) {
      console.error(error);
      showMessage(error.message || "Could not save this item.", true);
    }
  });

  typeInput.addEventListener("change", updateFormFields);
  $("cancelEdit").addEventListener("click", resetForm);
  ["search", "filterType", "filterStatus"].forEach(key => $(key).addEventListener(
    key === "search" ? "input" : "change", () => render().catch(console.error)
  ));

  $("exportButton").addEventListener("click", async () => {
    try {
      const [projects, tasks, notes] = await Promise.all([
        getAll("projects"), getAll("tasks"), getAll("notes")
      ]);
      const backup = {
        app: "BuildBoard", schemaVersion: 2,
        exportedAt: new Date().toISOString(), projects, tasks, notes
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `buildboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showMessage("Backup exported. Keep it somewhere safe.");
    } catch (error) {
      console.error(error);
      showMessage("Could not export your backup.", true);
    }
  });

  $("importButton").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Backup must be smaller than 10 MB.");
      const backup = JSON.parse(await file.text());
      if (backup.app !== "BuildBoard" || backup.schemaVersion !== 2 ||
          !Array.isArray(backup.projects) || !Array.isArray(backup.tasks) ||
          !Array.isArray(backup.notes)) throw new Error("This is not a supported BuildBoard V2 backup.");
      const valid = (items, type) => items.every(x =>
        x && typeof x.id === "string" && typeof x.title === "string" &&
        typeof x.description === "string" && Number.isFinite(x.createdAt) &&
        Number.isFinite(x.updatedAt) &&
        (x.status === undefined ||
          ["planned", "in-progress", "completed", "open", "done"].includes(x.status)));
      if (!valid(backup.projects, "project") || !valid(backup.tasks, "task") ||
          !valid(backup.notes, "note")) throw new Error("The backup contains invalid records.");
      if (backup.projects.length + backup.tasks.length + backup.notes.length > 20000)
        throw new Error("The backup contains too many records.");
      if (!confirm("Restore this backup? It will replace the data currently in this browser.")) return;
      await transaction(STORES, "readwrite", tx => {
        for (const storeName of STORES) {
          const store = tx.objectStore(storeName);
          store.clear();
          const items = storeName === "projects" ? backup.projects :
            storeName === "tasks" ? backup.tasks : backup.notes;
          items.forEach(item => store.put(item));
        }
      });
      resetForm();
      await render();
      showMessage("Backup restored successfully.");
    } catch (error) {
      console.error(error);
      showMessage(error.message || "Import failed.", true);
    } finally {
      event.target.value = "";
    }
  });

  async function start() {
    try {
      if (!("indexedDB" in window)) throw new Error("This browser does not support IndexedDB.");
      db = await openDB();
      await refreshProjectOptions();
      await render();
      if ("serviceWorker" in navigator && location.protocol !== "file:") {
        navigator.serviceWorker.register("./sw.js").catch(error =>
          console.warn("Offline caching could not be enabled:", error));
      }
    } catch (error) {
      console.error(error);
      showMessage(error.message || "BuildBoard could not start.", true);
    }
  }

  start();
})();