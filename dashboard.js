const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedExtensions = new Set(["png", "jpg", "jpeg", "gif", "mp4", "webm", "mov"]);
const maxFileSize = 64 * 1024 * 1024;
const form = document.querySelector("[data-project-form]");
const editor = document.querySelector("[data-editor]");
const emptyState = document.querySelector("[data-empty-state]");
const projectList = document.querySelector("[data-project-list]");
const status = document.querySelector("[data-save-status]");
const toast = document.querySelector("[data-toast]");
const fileInput = document.querySelector("[data-media-input]");
const formFeedback = document.querySelector("[data-form-feedback]");

let projects = [];
let currentProject = null;
let isCreating = false;
let isDirty = false;
let toastTimeout;

function showToast(message, isError = false) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Permintaan gagal (${response.status}).`);
  }
  return result;
}

function getMediaSource(media) {
  return media.src || media.image || "";
}

function getMediaType(media) {
  if (media.type) {
    return media.type;
  }
  return /\.(?:mp4|webm|mov)$/i.test(getMediaSource(media)) ? "video" : "image";
}

function mediaFileName(media) {
  return media.name || getMediaSource(media).split("/").pop() || "Project media";
}

function renderProjectList() {
  projectList.replaceChildren();
  projects.forEach((project, index) => {
    const button = document.createElement("button");
    button.className = "dashboard-project-link";
    button.type = "button";
    button.classList.toggle("is-active", currentProject?.slug === project.slug);
    button.addEventListener("click", () => selectProject(project.slug));

    const number = document.createElement("span");
    number.className = "dashboard-project-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "dashboard-project-name";
    name.textContent = project.title;
    const year = document.createElement("span");
    year.className = "dashboard-project-year";
    year.textContent = project.year;
    button.append(number, name, year);
    projectList.append(button);
  });
}

function fillForm(project) {
  form.elements.namedItem("title").value = project.title || "";
  form.elements.namedItem("slug").value = project.slug || "";
  form.elements.namedItem("year").value = project.year || "";
  form.elements.namedItem("client").value = project.client || "";
  form.elements.namedItem("studio").value = project.studio || "5S.MOTION";
  form.elements.namedItem("description").value = project.description || "";
  form.elements.namedItem("slug").readOnly = !isCreating;
  delete form.elements.namedItem("slug").dataset.edited;
  document.querySelector("[data-editor-kicker]").textContent = isCreating
    ? "Project / Baru"
    : `Project / ${project.slug}`;
  document.querySelector("[data-editor-title]").textContent = project.title || "Project baru";
  document.querySelector("[data-delete-project]").hidden = isCreating;
  document.querySelector("[data-save-project]").textContent = isCreating
    ? "Buat project"
    : "Simpan perubahan";
  fileInput.disabled = isCreating;
  formFeedback.textContent = isCreating ? "Simpan project sebelum menambahkan media." : "";
}

function renderMedia() {
  const mediaGrid = document.querySelector("[data-media-grid]");
  const emptyMedia = document.querySelector("[data-empty-media]");
  mediaGrid.replaceChildren();
  const gallery = currentProject?.gallery || [];

  gallery.forEach((media) => {
    const source = getMediaSource(media);
    const type = getMediaType(media);
    const coverMedia = currentProject.image
      ? gallery.find((item) => getMediaSource(item) === currentProject.image)
      : gallery[0];
    const isCover = coverMedia === media;
    const card = document.createElement("article");
    card.className = "media-card";

    const preview = document.createElement("div");
    preview.className = "media-preview";
    if (type === "video") {
      const video = document.createElement("video");
      video.src = source;
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.setAttribute("aria-label", media.alt || mediaFileName(media));
      preview.append(video);
      const videoBadge = document.createElement("span");
      videoBadge.className = "media-video-badge";
      videoBadge.textContent = "Video";
      preview.append(videoBadge);
    } else {
      const image = document.createElement("img");
      image.src = source;
      image.alt = media.alt || mediaFileName(media);
      image.loading = "lazy";
      preview.append(image);
    }

    if (isCover) {
      const coverBadge = document.createElement("span");
      coverBadge.className = "media-cover-badge";
      coverBadge.textContent = "Homepage";
      preview.append(coverBadge);
    }

    const cardInfo = document.createElement("div");
    cardInfo.className = "media-card-info";
    const filename = document.createElement("span");
    filename.className = "media-filename";
    filename.textContent = mediaFileName(media);
    filename.title = mediaFileName(media);

    const actions = document.createElement("div");
    actions.className = "media-card-actions";
    if (!isCover) {
      const coverButton = document.createElement("button");
      coverButton.className = "media-cover-button";
      coverButton.type = "button";
      coverButton.textContent = "Pakai di home";
      coverButton.addEventListener("click", () => setCover(source, media.alt || currentProject.title));
      actions.append(coverButton);
    }

    const deleteButton = document.createElement("button");
    deleteButton.className = "media-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Hapus";
    deleteButton.disabled = !source.startsWith(`/uploads/${currentProject.slug}/`);
    if (deleteButton.disabled) {
      deleteButton.title = "Media bawaan tidak dapat dihapus.";
    }
    deleteButton.addEventListener("click", () => deleteMedia(media));
    actions.append(deleteButton);
    cardInfo.append(filename, actions);
    card.append(preview, cardInfo);
    mediaGrid.append(card);
  });

  emptyMedia.classList.toggle("is-visible", gallery.length === 0);
  emptyMedia.textContent = isCreating
    ? "Simpan project sebelum menambahkan foto atau video."
    : "Belum ada media. Tambahkan foto atau video untuk memulai.";
}

function selectProject(slug) {
  if (isDirty && !window.confirm("Perubahan belum disimpan. Buang perubahan dan lanjutkan?")) {
    return;
  }

  const project = projects.find((entry) => entry.slug === slug);
  if (!project) {
    return;
  }
  currentProject = project;
  isCreating = false;
  isDirty = false;
  emptyState.hidden = true;
  editor.hidden = false;
  fillForm(project);
  renderMedia();
  renderProjectList();
  setStatus("Tersimpan");
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function startNewProject() {
  if (isDirty && !window.confirm("Perubahan belum disimpan. Buang perubahan dan lanjutkan?")) {
    return;
  }
  currentProject = {
    slug: "",
    title: "",
    year: String(new Date().getFullYear()),
    client: "",
    studio: "5S.MOTION",
    description: "",
    image: "",
    imageAlt: "",
    gallery: [],
  };
  isCreating = true;
  isDirty = false;
  emptyState.hidden = true;
  editor.hidden = false;
  fillForm(currentProject);
  renderMedia();
  renderProjectList();
  form.elements.namedItem("title").focus();
  setStatus("Project baru");
}

function readForm(slug) {
  return {
    slug,
    title: form.elements.namedItem("title").value.trim(),
    year: form.elements.namedItem("year").value.trim(),
    client: form.elements.namedItem("client").value.trim(),
    studio: form.elements.namedItem("studio").value.trim(),
    description: form.elements.namedItem("description").value.trim(),
    image: currentProject.image || "",
    imageAlt: currentProject.imageAlt || form.elements.namedItem("title").value.trim(),
  };
}

async function saveProject(event) {
  event.preventDefault();
  if (!form.reportValidity()) {
    return;
  }

  const title = form.elements.namedItem("title").value.trim();
  const slugInput = form.elements.namedItem("slug");
  const slug = (slugInput.value.trim() || slugify(title)).toLowerCase();
  slugInput.value = slug;
  if (!slugPattern.test(slug)) {
    slugInput.setCustomValidity("Gunakan huruf kecil, angka, dan tanda hubung.");
    slugInput.reportValidity();
    slugInput.setCustomValidity("");
    return;
  }

  const saveButton = document.querySelector("[data-save-project]");
  const creatingProject = isCreating;
  saveButton.disabled = true;
  formFeedback.textContent = "";
  setStatus("Menyimpan...");
  try {
    const payload = readForm(slug);
    const savedProject = isCreating
      ? await apiRequest("/api/projects", { method: "POST", body: JSON.stringify(payload) })
      : await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });

    const existingIndex = projects.findIndex((entry) => entry.slug === savedProject.slug);
    if (existingIndex < 0) {
      projects.push(savedProject);
    } else {
      projects[existingIndex] = savedProject;
    }
    currentProject = savedProject;
    isCreating = false;
    isDirty = false;
    fillForm(savedProject);
    renderMedia();
    renderProjectList();
    setStatus("Tersimpan");
    showToast(creatingProject ? "Project berhasil dibuat." : "Project berhasil disimpan.");
    history.replaceState(null, "", `/dashboard?project=${encodeURIComponent(savedProject.slug)}`);
  } catch (error) {
    console.error(error);
    formFeedback.textContent = error.message;
    setStatus("Gagal menyimpan", true);
  } finally {
    saveButton.disabled = false;
  }
}

function fileToBase64(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  });
}

async function uploadMedia() {
  const files = [...fileInput.files];
  fileInput.value = "";
  if (!files.length || !currentProject || isCreating) {
    return;
  }

  const rejectedFiles = files.filter((file) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    return !allowedExtensions.has(extension) || file.size > maxFileSize;
  });
  if (rejectedFiles.length) {
    showToast(
      `${rejectedFiles.map((file) => file.name).join(", ")}: format tidak didukung atau file lebih dari 64 MB.`,
      true,
    );
    if (rejectedFiles.length === files.length) {
      return;
    }
  }
  const acceptedFiles = files.filter((file) => !rejectedFiles.includes(file));

  try {
    for (let offset = 0; offset < acceptedFiles.length; offset += 8) {
      const batch = acceptedFiles.slice(offset, offset + 8);
      setStatus(`Mengunggah ${Math.min(offset + batch.length, acceptedFiles.length)}/${acceptedFiles.length}...`);
      const payload = await Promise.all(
        batch.map(async (file) => ({
          name: file.name,
          alt: currentProject.title,
          data: await fileToBase64(file),
        })),
      );
      await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}/media`, {
        method: "POST",
        body: JSON.stringify({ files: payload }),
      });
    }

    projects = await apiRequest("/api/projects");
    currentProject = projects.find((project) => project.slug === currentProject.slug);
    renderMedia();
    renderProjectList();
    setStatus(isDirty ? "Perubahan belum disimpan" : "Tersimpan", false);
    showToast(`${acceptedFiles.length} media berhasil diunggah.`);
  } catch (error) {
    console.error(error);
    setStatus("Upload gagal", true);
    showToast(error.message, true);
    projects = await apiRequest("/api/projects");
    currentProject = projects.find((project) => project.slug === currentProject.slug);
    renderMedia();
  }
}

async function setCover(source, alt) {
  try {
    const payload = {
      slug: currentProject.slug,
      title: currentProject.title,
      year: currentProject.year,
      client: currentProject.client,
      studio: currentProject.studio,
      description: currentProject.description,
      image: source,
      imageAlt: alt,
    };
    const updatedProject = await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    projects = projects.map((project) =>
      project.slug === updatedProject.slug ? updatedProject : project,
    );
    currentProject = updatedProject;
    renderMedia();
    setStatus(isDirty ? "Perubahan belum disimpan" : "Tersimpan");
    showToast("Media homepage berhasil diperbarui.");
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
}

async function deleteMedia(media) {
  const source = getMediaSource(media);
  const match = source.match(/^\/uploads\/([a-z0-9-]+)\/([a-z0-9-]+\.[a-z0-9]+)$/);
  if (!match) {
    showToast("Media bawaan tidak dapat dihapus dari dashboard.", true);
    return;
  }
  if (!window.confirm(`Hapus media "${mediaFileName(media)}"?`)) {
    return;
  }

  try {
    const [, slug, filename] = match;
    const updatedProject = await apiRequest(
      `/api/projects/${encodeURIComponent(slug)}/media/${encodeURIComponent(filename)}`,
      { method: "DELETE" },
    );
    projects = projects.map((project) =>
      project.slug === updatedProject.slug ? updatedProject : project,
    );
    currentProject = updatedProject;
    renderMedia();
    setStatus("Tersimpan");
    showToast("Media berhasil dihapus.");
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
}

async function deleteProject() {
  if (!currentProject || isCreating) {
    return;
  }
  if (!window.confirm(`Hapus project "${currentProject.title}" dari website?`)) {
    return;
  }

  try {
    await apiRequest(`/api/projects/${encodeURIComponent(currentProject.slug)}`, {
      method: "DELETE",
    });
    projects = projects.filter((project) => project.slug !== currentProject.slug);
    currentProject = null;
    isDirty = false;
    editor.hidden = true;
    renderProjectList();
    if (projects.length) {
      selectProject(projects[0].slug);
    } else {
      emptyState.hidden = false;
      setStatus("Project dihapus");
    }
    history.replaceState(null, "", "/dashboard");
    showToast("Project berhasil dihapus.");
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
}

form.addEventListener("input", (event) => {
  isDirty = true;
  setStatus("Perubahan belum disimpan");
  if (event.target.name === "title" && isCreating) {
    const slugField = form.elements.namedItem("slug");
    if (!slugField.dataset.edited) {
      slugField.value = slugify(event.target.value);
    }
  }
  if (event.target.name === "slug") {
    event.target.dataset.edited = "true";
  }
});
form.addEventListener("submit", saveProject);
fileInput.addEventListener("change", uploadMedia);
document.querySelector("[data-new-project]").addEventListener("click", startNewProject);
document.querySelector("[data-empty-new-project]").addEventListener("click", startNewProject);
document.querySelector("[data-delete-project]").addEventListener("click", deleteProject);

async function initializeDashboard() {
  try {
    projects = await apiRequest("/api/projects");
    renderProjectList();
    const requestedProject = new URLSearchParams(location.search).get("project");
    if (requestedProject && projects.some((project) => project.slug === requestedProject)) {
      selectProject(requestedProject);
    } else if (projects.length) {
      selectProject(projects[0].slug);
    } else {
      emptyState.hidden = false;
      setStatus("Belum ada project");
    }
  } catch (error) {
    console.error(error);
    setStatus("Gagal memuat project", true);
    showToast(error.message, true);
    emptyState.hidden = false;
  }
}

initializeDashboard();
