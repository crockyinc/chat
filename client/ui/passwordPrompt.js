/**
 * "Password required to send" dialog.
 *
 * Every send goes through this prompt: the composer's Send button, Enter in the
 * composer, and the Send button in the full-screen editor. The message is only
 * handed to the server together with the entered password; the server verifies
 * it and refuses to store the message if it is wrong (see
 * `verifySendPassword`), so the check cannot be bypassed from the client.
 */

const MODAL_ID = 'passwordModal';

/**
 * Opens the dialog and resolves with the entered password.
 * Resolves `null` when the user cancels (the caller must then not send).
 *
 * @param {{ heading?: string, message?: string }} [options]
 * @returns {Promise<string|null>}
 */
export function promptSendPassword(options = {}) {
  const { heading = 'Password required', message = 'Enter the password to send this message.' } = options;
  const modal = document.getElementById(MODAL_ID);
  const form = document.getElementById('passwordForm');
  const input = document.getElementById('passwordInput');
  const error = document.getElementById('passwordError');
  const headingEl = document.getElementById('passwordHeading');
  const messageEl = document.getElementById('passwordMessage');

  // Fallback for a missing dialog (e.g. a stripped-down shell): never block sending.
  if (!modal || !form || !input) return Promise.resolve(prompt('Password required to send') || null);

  if (headingEl) headingEl.textContent = heading;
  if (messageEl) messageEl.textContent = message;
  error?.classList.add('hidden');
  input.value = '';
  input.type = 'password';
  input.removeAttribute('aria-invalid');

  modal.classList.remove('hidden');
  modal.classList.add('grid');
  // Focus after the browser has painted the dialog.
  requestAnimationFrame(() => input.focus());

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      document.removeEventListener('keydown', onKeyDown, true);
      modal.removeEventListener('mousedown', onBackdrop);
      modal._onClose = null;
      modal.classList.add('hidden');
      modal.classList.remove('grid');
      input.value = '';
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      const value = input.value;
      if (!value) {
        showError('Please enter the password');
        return;
      }
      finish(value);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    };

    const onBackdrop = (event) => {
      if (event.target === modal) finish(null);
    };

    const showError = (text) => {
      if (!error) return;
      error.textContent = text;
      error.classList.remove('hidden');
      input.setAttribute('aria-invalid', 'true');
      input.select();
    };

    // The dialog owns Escape while it is open (capture phase, so it wins over
    // other modal handlers).
    form.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKeyDown, true);
    modal.addEventListener('mousedown', onBackdrop);
    modal._onClose = () => finish(null);

    /** Shows an error inside the still-open dialog (used for wrong passwords). */
    modal._showError = showError;
  });
}

/**
 * Sends with a password prompt and retries on a wrong password without losing
 * the draft: the prompt explains the problem and lets the user try again.
 *
 * @param {(password: string) => Promise<void>} send  performs the actual send
 */
export async function sendWithPasswordPrompt(send) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const password = await promptSendPassword(
      attempt === 0
        ? undefined
        : { heading: 'Wrong password', message: 'That password was not accepted. Please try again.' },
    );
    if (password === null) return { sent: false, reason: 'cancelled' };

    try {
      await send(password);
      return { sent: true };
    } catch (error) {
      const isPasswordError = error?.status === 403 || /password/i.test(error?.message || '');
      if (!isPasswordError) throw error;
      // Loop once more with the "wrong password" variant of the dialog.
    }
  }
  return { sent: false, reason: 'too-many-attempts' };
}
