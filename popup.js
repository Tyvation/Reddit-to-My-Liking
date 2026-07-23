const DEFAULTS = { fullWidthPercent: 100, compactWidthPercent: 60 };
const full = document.getElementById('full-width');
const compact = document.getElementById('compact-width');
const fullValue = document.getElementById('full-value');
const compactValue = document.getElementById('compact-value');
const status = document.getElementById('status');

function render() {
  compact.max = full.value;
  if (Number(compact.value) > Number(full.value)) compact.value = full.value;
  fullValue.value = `${full.value}%`;
  compactValue.value = `${compact.value}%`;
}

async function save() {
  render();
  await chrome.storage.local.set({
    fullWidthPercent: Number(full.value),
    compactWidthPercent: Number(compact.value)
  });
  status.textContent = 'Saved';
}

full.addEventListener('input', render);
compact.addEventListener('input', render);
full.addEventListener('change', save);
compact.addEventListener('change', save);
document.getElementById('reset').addEventListener('click', async () => {
  full.value = DEFAULTS.fullWidthPercent;
  compact.value = DEFAULTS.compactWidthPercent;
  await save();
});

chrome.storage.local.get(DEFAULTS).then(values => {
  full.value = values.fullWidthPercent;
  compact.value = values.compactWidthPercent;
  render();
});
