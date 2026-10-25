(() => {
  "use strict";
  let editedForm = null;

  // Inputs and POST actions keep their native behavior if this file fails to load.
  document.querySelectorAll("[data-crm-form]").forEach((form) => {
    const saveStatus = form.querySelector(".crm-save-bar > span");
    const markEdited = () => {
      editedForm = form;
      if (saveStatus) {
        saveStatus.textContent = "Tienes cambios sin guardar.";
        saveStatus.classList.add("crm-form-dirty");
        saveStatus.setAttribute("role", "status");
      }
    };
    form.addEventListener("input", markEdited);
    form.addEventListener("change", markEdited);
    const stage = form.querySelector('[name="stage"]');
    const reason = form.querySelector('[name="loss_reason"]');
    const reopen = form.querySelector('[name="reopen_reason"]');
    const previousStage = form.dataset.currentStage;

    const updateStageFields = () => {
      const lost = stage?.value === "lost";
      form.querySelectorAll("[data-loss-field]").forEach((field) => {
        // Preserve field errors until the user resolves them.
        field.hidden = !lost && !field.querySelector(".crm-field-error");
      });
      if (reason) reason.required = lost;
      const needsReopen = ["won", "delivered", "lost"].includes(previousStage)
        && stage?.value !== previousStage
        && !(previousStage === "won" && stage?.value === "delivered");
      const reopenField = form.querySelector("[data-reopen-field]");
      if (reopenField) reopenField.hidden = !needsReopen && !reopenField.querySelector(".crm-field-error");
      if (reopen) reopen.required = needsReopen;
    };
    stage?.addEventListener("change", updateStageFields);
    updateStageFields();

    const followup = form.querySelector('[name="next_followup"]');
    if (followup?.type === "datetime-local") {
      form.querySelectorAll("[data-date-shortcuts]").forEach((shortcuts) => {
        shortcuts.hidden = false;
        shortcuts.addEventListener("click", (event) => {
          const button = event.target.closest("[data-followup-days]");
          if (!button) return;
          const days = Number(button.dataset.followupDays);
          const date = new Date();
          if (days === 0) {
            date.setMinutes(date.getMinutes() + 60, 0, 0);
          } else {
            date.setDate(date.getDate() + days);
            date.setHours(10, 0, 0, 0);
          }
          const pad = (value) => String(value).padStart(2, "0");
          followup.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
          followup.dispatchEvent(new Event("input", { bubbles: true }));
          followup.dispatchEvent(new Event("change", { bubbles: true }));
          followup.focus();
        });
      });
    }

    // Reveal collapsed optional inputs when browser validation needs them.
    form.addEventListener("invalid", (event) => {
      const disclosure = event.target.closest("details");
      if (disclosure) disclosure.open = true;
    }, true);
  });

  // A repeated click must not create duplicate notes or contacts. Keeping the
  // submitter enabled preserves its name/value in normal browser form posts.
  document.querySelectorAll("[data-crm-form], [data-crm-action]").forEach((form) => {
    let submitting = false;
    form.addEventListener("submit", (event) => {
      if (event.defaultPrevented) return;
      if (editedForm && editedForm !== form) {
        event.preventDefault();
        let message = form.querySelector(".crm-unsaved-action");
        if (!message) {
          message = document.createElement("p");
          message.className = "crm-unsaved-action";
          message.setAttribute("role", "alert");
          form.append(message);
        }
        message.textContent = "Guarda primero los cambios de la ficha. Después podrás registrar este contacto o nota.";
        return;
      }
      if (submitting) {
        event.preventDefault();
        return;
      }
      if (!form.checkValidity()) return;
      editedForm = null;
      submitting = true;
      form.setAttribute("aria-busy", "true");
      const button = event.submitter;
      if (button) {
        button.setAttribute("aria-disabled", "true");
        button.dataset.originalLabel = button.textContent;
        button.textContent = "Guardando…";
      }
    });
    window.addEventListener("pageshow", () => {
      submitting = false;
      form.removeAttribute("aria-busy");
      form.querySelectorAll("[data-original-label]").forEach((button) => {
        button.textContent = button.dataset.originalLabel;
        button.removeAttribute("aria-disabled");
        delete button.dataset.originalLabel;
      });
    });
  });
  window.addEventListener("beforeunload", (event) => {
    if (editedForm) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
})();
