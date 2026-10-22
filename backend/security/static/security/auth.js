// Keep repeated clicks from replacing an in-flight sign-in or verification.
(() => {
  const forms = [...document.querySelectorAll('.auth-card form[method="post"]')];
  let submitting = false;
  const disabledButtons = [];
  let status;

  for (const form of forms) {
    form.addEventListener('submit', (event) => {
      if (submitting) {
        event.preventDefault();
        return;
      }
      if (event.defaultPrevented) return;
      submitting = true;
      form.setAttribute('aria-busy', 'true');
      for (const button of document.querySelectorAll('.auth-card button[type="submit"]:not(:disabled)')) {
        button.disabled = true;
        disabledButtons.push(button);
      }
      status = document.createElement('p');
      status.className = 'hint';
      status.setAttribute('role', 'status');
      status.textContent = 'Procesando… espera un momento.';
      form.append(status);
    });
  }

  window.addEventListener('pageshow', () => {
    submitting = false;
    for (const form of forms) form.removeAttribute('aria-busy');
    for (const button of disabledButtons.splice(0)) button.disabled = false;
    status?.remove();
  });
})();
