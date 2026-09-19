const $ = selector => document.querySelector(selector);
const uploadView = $('#uploadView');
const editorView = $('#editorView');
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
const editor = $('#jsonEditor');
let sourceFile;
let saveFormat;

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = ''; }, 3600);
}

function updateLines() {
  const count = editor.value.split('\n').length;
  $('#lines').textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  const before = editor.value.slice(0, editor.selectionStart).split('\n');
  $('#position').textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
}

async function openFile(file) {
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) return toast('That file exceeds the 100 MB limit.', true);
  toast('Decoding save…');
  try {
    const response = await fetch('/api/decode', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    sourceFile = file;
    saveFormat = result.format;
    editor.value = JSON.stringify(result.json, null, 2);
    $('#filename').textContent = file.name;
    $('#filemeta').textContent = `${(file.size / 1024).toFixed(1)} KB · ${result.format.compression.toUpperCase()} · ${result.format.encoding.toUpperCase()}`;
    uploadView.hidden = true;
    editorView.hidden = false;
    updateLines();
    toast('Save decoded successfully.');
  } catch (error) { toast(error.message, true); }
}

fileInput.addEventListener('change', () => openFile(fileInput.files[0]));
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', e => openFile(e.dataTransfer.files[0]));
$('#changeFile').addEventListener('click', () => { editorView.hidden = true; uploadView.hidden = false; fileInput.value = ''; });
$('#formatBtn').addEventListener('click', () => {
  try { editor.value = JSON.stringify(JSON.parse(editor.value), null, 2); updateLines(); toast('JSON formatted.'); }
  catch (error) { toast(`Invalid JSON: ${error.message}`, true); }
});
editor.addEventListener('input', updateLines);
editor.addEventListener('click', updateLines);
editor.addEventListener('keyup', updateLines);
editor.addEventListener('scroll', () => { $('#lines').scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const start = editor.selectionStart;
  editor.setRangeText('  ', start, editor.selectionEnd, 'end');
  updateLines();
});
$('#downloadBtn').addEventListener('click', async () => {
  try {
    const json = JSON.parse(editor.value);
    $('#status').textContent = 'Encoding…';
    const response = await fetch('/api/encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json, format: saveFormat }) });
    if (!response.ok) throw new Error((await response.json()).error);
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${sourceFile.name}.edited`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    $('#status').textContent = 'Export complete';
    toast('Edited WGS save exported. Keep your original backup!');
  } catch (error) { $('#status').textContent = 'Export failed'; toast(`Invalid JSON: ${error.message}`, true); }
});
