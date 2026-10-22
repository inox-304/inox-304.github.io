/* Read only the model selected by the administrator; nothing is uploaded until Save. */
document.addEventListener('change', async event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.name.endsWith('model_upload')) return;
  const scope = input.closest('.inline-related') || input.form;
  if (!scope) return;
  scope.querySelector('[data-model-inspection]')?.remove();
  const file = input.files?.[0];
  if (!file) return;
  const info = document.createElement('div');
  info.dataset.modelInspection = ''; info.className = 'inox-model-inspection'; info.setAttribute('role', 'status');
  input.after(info);
  if (file.size > 8 * 1024 * 1024) { info.textContent = 'El modelo supera 8 MB. Reduce texturas o geometría antes de subirlo.'; return; }
  try {
    const bytes = await file.arrayBuffer();
    if (input.files?.[0] !== file) return;
    const header = new DataView(bytes);
    if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(16, true) !== 0x4e4f534a) throw Error();
    const size = header.getUint32(12, true);
    if (size > bytes.byteLength - 20) throw Error();
    const model = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + size)));
    const append = (label, values, suffix) => {
      const names = [...new Set(values.filter(value => typeof value === 'string' && value.length <= 120))].slice(0, 40);
      const line = document.createElement('p'); line.textContent = `${label}: ${names.length ? 'pulsa un nombre para elegirlo.' : 'este archivo no incluye opciones con nombre.'}`;
      info.append(line);
      const target = scope.querySelector(`input[name="${suffix}"]`) || scope.querySelector(`input[name$="-${suffix}"]`);
      names.forEach(name => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = name;
        button.disabled = !target;
        button.addEventListener('click', () => { if (target) { target.value = name; target.dispatchEvent(new Event('change', { bubbles: true })); } });
        info.append(button);
      });
    };
    append('Animaciones disponibles', (model.animations || []).map(item => item.name), 'door_animation');
    if (input.closest('.inline-related')) append('Acabados disponibles', (model.extensions?.KHR_materials_variants?.variants || []).map(item => item.name), 'material_variant');
    const note = document.createElement('p'); note.textContent = 'Elige para puertas únicamente un clip que abra y cierre esas piezas. Cambiar acabados conserva la forma del modelo. Se verificará el archivo al guardar.'; info.append(note);
  } catch { info.textContent = 'No se pudo leer la estructura del GLB. Comprueba que sea GLB 2.0; el servidor lo validará al guardar.'; }
});
