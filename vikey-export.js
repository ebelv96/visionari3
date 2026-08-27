// vikey-export.js
//
// Si logga su my.vikey.it e replica il flusso manuale:
// Prenotazioni > Esporta > Lista Prenotazioni > range date > bottone Esporta.
// Vikey manda poi il CSV via email da sola, esattamente come nell'export manuale.
// Questo script non gestisce l'invio email: quello lo fa Vikey.
//
// Variabili d'ambiente richieste:
//   VIKEY_EMAIL    - email di login Vikey
//   VIKEY_PASSWORD - password di login Vikey
//
// Uso locale (per test / debug dei selettori):
//   HEADLESS=false node vikey-export.js
//
// Uso in CI:
//   node vikey-export.js

const { chromium } = require('playwright');

const VIKEY_EMAIL = process.env.VIKEY_EMAIL;
const VIKEY_PASSWORD = process.env.VIKEY_PASSWORD;
const HEADLESS = process.env.HEADLESS !== 'false';

// Data di inizio/fine range: fisse, aggiornale ogni tanto se vuoi tenerle
// "vicine" al presente. Range più stretto = CSV più piccolo = meno rischio
// di timeout su Apps Script quando lo elabora.
const START = { day: 1, monthIndex: 0, year: 2026 };   // 1 Gennaio 2026
const END = { day: 1, monthIndex: 0, year: 2028 };     // 1 Gennaio 2028

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

async function getCalendarCaption(page) {
  const text = (await page.locator('.rdp-caption_label').first().textContent()).trim();
  const parts = text.split(' ');
  const monthName = parts[0];
  const year = parseInt(parts[1], 10);
  return { monthIndex: MONTH_NAMES.indexOf(monthName), year };
}

async function navigateCalendarToMonth(page, targetMonthIndex, targetYear) {
  for (let attempts = 0; attempts < 80; attempts++) {
    const current = await getCalendarCaption(page);
    if (current.monthIndex === targetMonthIndex && current.year === targetYear) {
      return;
    }
    const diff = (targetYear - current.year) * 12 + (targetMonthIndex - current.monthIndex);
    const buttonName = diff > 0 ? 'Go to next month' : 'Go to previous month';
    await page.getByRole('button', { name: buttonName }).click();
    await page.waitForTimeout(120);
  }
  throw new Error(
    'Non sono riuscito a raggiungere il mese ' + (targetMonthIndex + 1) + '/' + targetYear +
    ' del calendario dopo troppi tentativi.'
  );
}

async function selectCalendarDay(page, day) {
  const daySpan = page
    .locator('button.rdp-day span[aria-hidden="true"]')
    .filter({ hasText: new RegExp('^' + day + '$') });
  await daySpan.first().click();
  await page.waitForTimeout(150);
}

if (!VIKEY_EMAIL || !VIKEY_PASSWORD) {
  console.error('Mancano VIKEY_EMAIL e/o VIKEY_PASSWORD nelle variabili d\'ambiente.');
  process.exit(1);
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();

  try {
    console.log('Apro my.vikey.it...');
    // 'networkidle' spesso non scatta mai su app con polling/websocket in
    // background, quindi usiamo 'domcontentloaded' e poi aspettiamo un
    // elemento specifico invece di aspettare che la rete si fermi del tutto.
    await page.goto('https://my.vikey.it/', { waitUntil: 'domcontentloaded' });

    console.log('Aspetto il form di login...');
    // I campi Vikey non hanno una <label>, hanno solo il placeholder.
    // Il bottone "Accedi" è un <div>, non un <button> vero.
    const emailField = page.getByPlaceholder('Email');
    await emailField.waitFor({ state: 'visible', timeout: 30000 });

    console.log('Login...');
    await emailField.fill(VIKEY_EMAIL);
    await page.getByPlaceholder('Password').fill(VIKEY_PASSWORD);
    await page.getByText('Accedi', { exact: true }).click();

    console.log('Aspetto che il login vada a buon fine...');
    // Aspettiamo che sparisca il campo email di login (segno che siamo
    // usciti dalla pagina di login ed entrati nella dashboard).
    await emailField.waitFor({ state: 'hidden', timeout: 30000 });
    console.log('Login effettuato.');

    console.log('Navigo su Prenotazioni...');
    const prenotazioniLink = page.getByText('Prenotazioni', { exact: true });
    await prenotazioniLink.waitFor({ state: 'visible', timeout: 30000 });
    await prenotazioniLink.click();

    console.log('Apro Esporta...');
    const esportaNavButton = page.getByText('Esporta', { exact: true }).first();
    await esportaNavButton.waitFor({ state: 'visible', timeout: 30000 });
    await esportaNavButton.click();

    console.log('Seleziono Lista Prenotazioni...');
    const listaPrenotazioni = page.getByText('Lista prenotazioni', { exact: true });
    await listaPrenotazioni.waitFor({ state: 'visible', timeout: 30000 });
    await listaPrenotazioni.click();

    console.log('Apro il selettore date...');
    const dateRangeDisplay = page.getByText(/\d{2}-\d{2}-\d{4}\s*->\s*\d{2}-\d{2}-\d{4}/);
    await dateRangeDisplay.waitFor({ state: 'visible', timeout: 30000 });
    await dateRangeDisplay.click();

    console.log('Aspetto che compaia il calendario...');
    await page.locator('.rdp-caption_label').first().waitFor({ state: 'visible', timeout: 30000 });

    console.log('Navigo alla data di inizio (' + START.day + '/' + (START.monthIndex + 1) + '/' + START.year + ')...');
    await navigateCalendarToMonth(page, START.monthIndex, START.year);
    await selectCalendarDay(page, START.day);

    console.log('Navigo alla data di fine (' + END.day + '/' + (END.monthIndex + 1) + '/' + END.year + ')...');
    await navigateCalendarToMonth(page, END.monthIndex, END.year);
    await selectCalendarDay(page, END.day);

    console.log('Date selezionate. Clicco il bottone Esporta finale...');
    const finalExportButton = page.locator('div.text-md', { hasText: 'Esporta' });
    await finalExportButton.waitFor({ state: 'visible', timeout: 30000 });
    await finalExportButton.click();

    // Diamo tempo a Vikey di processare e inviare l'email
    await page.waitForTimeout(5000);

    console.log('Export completato. Vikey invierà il CSV via email a breve.');
  } catch (err) {
    console.error('Errore durante l\'export:', err);
    // Screenshot di debug, utile se lo step CI lo carica come artifact
    try {
      await page.screenshot({ path: 'vikey-export-error.png', fullPage: true });
    } catch (screenshotErr) {
      console.error('Impossibile salvare screenshot:', screenshotErr);
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
