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
    // Regex case-insensitive: copre sia "Go to next month" (react-day-picker v8)
    // sia "Go to the Next Month" (v9), nel caso Vikey aggiorni la libreria.
    const buttonName = diff > 0 ? /next month/i : /previous month/i;
    let navButton = page.getByRole('button', { name: buttonName });
    // Le frecce sono solo icone (‹ ›): se l'aria-label non corrisponde,
    // fallback sulle classi di react-day-picker (v9 e v8).
    if (await navButton.count() === 0) {
      navButton = page.locator(diff > 0
        ? '.rdp-button_next, .rdp-nav_button_next'
        : '.rdp-button_previous, .rdp-nav_button_previous');
    }
    await navButton.first().click();
    await page.waitForTimeout(120);
  }
  throw new Error(
    'Non sono riuscito a raggiungere il mese ' + (targetMonthIndex + 1) + '/' + targetYear +
    ' del calendario dopo troppi tentativi.'
  );
}

async function selectCalendarDay(page, day) {
  const dayRe = new RegExp('^\\s*' + day + '\\s*$');
  // Struttura attuale (react-day-picker v8): <button class="rdp-day"><span aria-hidden>1</span>
  // Il calendario ora mostra anche i giorni del mese dopo in grigio
  // (es. 1-5 dicembre sotto novembre): li escludiamo sempre.
  let daySpan = page
    .locator('button.rdp-day:not(.rdp-day_outside) span[aria-hidden="true"]')
    .filter({ hasText: dayRe });
  // Fallback per react-day-picker v9: <td class="rdp-day"><button class="rdp-day_button">1</button>
  if (await daySpan.count() === 0) {
    daySpan = page
      .locator('td.rdp-day:not(.rdp-outside):not([data-outside]) button.rdp-day_button')
      .filter({ hasText: dayRe });
  }
  await daySpan.first().click();
  await page.waitForTimeout(150);
}

if (!VIKEY_EMAIL || !VIKEY_PASSWORD) {
  console.error('Mancano VIKEY_EMAIL e/o VIKEY_PASSWORD nelle variabili d\'ambiente.');
  process.exit(1);
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  // Finestra più alta del default (720px): la modale "Esporta Prenotazioni"
  // di Vikey ora ha più campi e veniva tagliata in basso.
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });

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
    // getByText trovava 5 elementi diversi con testo "Prenotazioni" (card di
    // riepilogo sulla dashboard + voce di menu). La voce di menu vera ha un
    // aria-label univoco, usiamo quello per essere precisi.
    const prenotazioniLink = page.getByLabel('Prenotazioni', { exact: true });
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
    // A nov 2026 Vikey mostra il range con la freccia "→" invece di "->":
    // accettiamo entrambe (più trattini lunghi, per sicurezza).
    const dateRangeDisplay = page
      .getByText(/\d{2}-\d{2}-\d{4}\s*(?:->|→|–|—)\s*\d{2}-\d{2}-\d{4}/)
      .first();
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

    // Il calendario resta aperto sopra la modale: lo chiudiamo cliccando
    // sul titolo (fuori dal popover), così non copre il bottone Esporta.
    // NON usiamo Escape: chiuderebbe l'intera modale.
    const calendar = page.locator('.rdp-caption_label').first();
    if (await calendar.isVisible()) {
      await page.getByText('Esporta Prenotazioni', { exact: true }).first().click();
      await page.waitForTimeout(300);
    }

    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => pad(d.day) + '-' + pad(d.monthIndex + 1) + '-' + d.year;
    const expected = fmt(START) + ' → ' + fmt(END);
    try {
      const shown = (await dateRangeDisplay.textContent()).trim();
      console.log('Range impostato: ' + shown + ' (atteso: ' + expected + ')');
      if (!shown.includes(fmt(START)) || !shown.includes(fmt(END))) {
        console.warn('ATTENZIONE: il range mostrato non coincide con quello atteso.');
      }
    } catch (_) { /* solo log, non bloccante */ }

    console.log('Date selezionate. Clicco il bottone Esporta finale...');
    // Testo ESATTO "Esporta": la nuova modale ha il titolo "Esporta Prenotazioni"
    // che con il match parziale darebbe 2 elementi (errore strict mode).
    // .last() = quello nella modale, che sta in fondo al DOM.
    const finalExportButton = page
      .locator('div.text-md')
      .filter({ hasText: /^\s*Esporta\s*$/ })
      .last();
    await finalExportButton.waitFor({ state: 'visible', timeout: 30000 });
    await finalExportButton.click();

    // Diamo tempo a Vikey di processare e inviare l'email
    await page.waitForTimeout(5000);

    console.log('Export completato. Vikey invierà il CSV via email a breve.');
  } catch (err) {
    console.error('Errore durante l\'export:', err && err.message ? err.message : err);
    console.error(err);
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
