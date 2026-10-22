// This is a shortcut only; the server still requires a password and a second factor.
document.querySelectorAll<HTMLButtonElement>('[data-admin-entry]').forEach(button => {
  let taps = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    taps = 0;
  };
  button.addEventListener('click', () => {
    clearTimeout(timeout);
    taps += 1;
    if (taps === 6) {
      reset();
      window.location.assign(button.dataset.adminEntry!);
      return;
    }
    timeout = setTimeout(reset, 5000);
  });
});
