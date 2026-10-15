// This is a shortcut only; the server still requires a password and a second factor.
document.querySelectorAll<HTMLButtonElement>('[data-admin-entry]').forEach(button => {
  let taps = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const status = document.getElementById(button.getAttribute('aria-describedby') || '');
  const reset = () => {
    taps = 0;
    if (status) status.textContent = '';
  };
  button.addEventListener('click', () => {
    clearTimeout(timeout);
    taps += 1;
    if (taps === 6) {
      reset();
      window.location.assign(button.dataset.adminEntry!);
      return;
    }
    if (status) status.textContent = `${taps} de 6 · Acceso de administración`;
    timeout = setTimeout(reset, 5000);
  });
});
