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
const MONTH_NAMES_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];
const CAPTION_RE = new RegExp(
  '^\\s*(' + MONTH_NAMES.concat(MONTH_NAMES_IT).join('|') + ')\\s+\\d{4}\\s*$', 'i'
);

// Nov 2026: Vikey ha un calendario nuovo (stile shadcn) che può sostituire
// le classi standard "rdp-*". Per questo troviamo gli elementi dal TESTO
// e dai ruoli ARIA, non dalle classi CSS.

// Intestazione del mese, es. "November 2026"
// .last(): il calendario è un popover aggiunto in fondo alla pagina, così
// evitiamo eventuali altri "November 2026" presenti nella pagina sotto.
function calendarCaption(page) {
  return page.getByText(CAPTION_RE).last();
}

async function getCalendarCaption(page) {
  const text = (await calendarCaption(page).textContent()).trim();
  const parts = text.split(/\s+/);
  const name = parts[0].toLowerCase();
  let monthIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === name);
  if (monthIndex < 0) monthIndex = MONTH_NAMES_IT.indexOf(name);
  return { monthIndex, year: parseInt(parts[1], 10) };
}

async function clickMonthArrow(page, forward) {
  // 1) aria-label: "Go to next month" (v8) / "Go to the Next Month" (v9)
  let btn = page.getByRole('button', { name: forward ? /next month/i : /previous month/i });
  if (await btn.count() > 0) {
    await btn.first().click();
    return;
  }
  // 2) Frecce senza etichetta: sono i bottoni SENZA numeri nel contenitore
  //    del calendario (i giorni invece hanno numeri). Prima = ‹, ultima = ›.
  const arrows = calendarCaption(page)
    .locator('xpath=ancestor::*[.//button[not(normalize-space())] or .//button[.//svg]][1]')
    .locator('button')
    .filter({ hasNotText: /\d/ });
  if (await arrows.count() >= 2) {
    await (forward ? arrows.last() : arrows.first()).click();
    return;
  }
  throw new Error('Non trovo le frecce del calendario (' + (forward ? 'avanti' : 'indietro') + ').');
}

async function navigateCalendarToMonth(page, targetMonthIndex, targetYear) {
  for (let attempts = 0; attempts < 80; attempts++) {
    const current = await getCalendarCaption(page);
    if (current.monthIndex < 0 || isNaN(current.year)) {
      throw new Error('Intestazione del calendario non riconosciuta.');
    }
    if (current.monthIndex === targetMonthIndex && current.year === targetYear) {
      return;
    }
    const diff = (targetYear - current.year) * 12 + (targetMonthIndex - current.monthIndex);
    await clickMonthArrow(page, diff > 0);
    await page.waitForTimeout(150);
  }
  throw new Error(
    'Non sono riuscito a raggiungere il mese ' + (targetMonthIndex + 1) + '/' + targetYear +
    ' del calendario dopo troppi tentativi.'
  );
}

async function selectCalendarDay(page, day) {
  const dayRe = new RegExp('^\\s*' + day + '\\s*$');
  // Il calendario mostra anche i giorni del mese prima/dopo in grigio
  // (es. 1-5 dicembre sotto novembre): li escludiamo sempre.
  // Copre: v9/shadcn (<td role="gridcell" data-outside> <button>),
  //        v8 (<button role="gridcell" class="rdp-day_outside">).
  const days = page
    .locator([
      // Calendario Vikey nov 2026 (rdp v8 + classi shadcn): <td><button class="rdp-button ...">
      //   <span aria-hidden="true">1</span><span class="rdp-vhidden">1st January (Thursday)</span>
      // I giorni grigi del mese prima/dopo hanno la classe "day-outside".
      '[role="grid"] td button.rdp-button:not(.day-outside) span[aria-hidden="true"]',
      '[role="grid"] td[role="gridcell"]:not([data-outside="true"]):not(.rdp-outside) button',
      '[role="grid"] button[role="gridcell"]:not(.rdp-day_outside)',
      'button.rdp-day:not(.rdp-day_outside)'
    ].join(', '))
    .filter({ hasText: dayRe });
  if (await days.count() > 0) {
    await days.first().click();
  } else {
    // Piano B (calendario Vikey nov 2026): i giorni non sono <button> in una
    // griglia ARIA. Cerchiamo il numero come testo dentro il popover del
    // calendario (il contenitore più vicino all'intestazione che contiene "15").
    const popover = calendarCaption(page)
      .locator('xpath=ancestor::*[.//*[normalize-space()="15"]][1]');
    const byText = popover.getByText(String(day), { exact: true });
    const n = await byText.count();
    if (n === 0) {
      throw new Error('Non trovo il giorno ' + day + ' nel calendario.');
    }
    // I giorni grigi del mese PRIMA sono numeri alti (es. 28-31) e stanno
    // all'inizio; quelli del mese DOPO sono numeri bassi (1-6) e stanno in fondo.
    // Quindi: giorno basso -> prima occorrenza, giorno alto -> ultima.
    await (day <= 15 ? byText.first() : byText.last()).click();
  }
  await page.waitForTimeout(200);
}

// In caso di errore scrive nel log quello che serve per correggere i selettori:
// URL, testo visibile della modale e HTML del calendario.
async function dumpDebug(page) {
  try {
    console.error('--- DEBUG ---');
    console.error('URL: ' + page.url());
    const info = await page.evaluate(() => {
      const out = {};
      const all = Array.from(document.querySelectorAll('body *'));
      const title = all.find((el) => el.childElementCount === 0 &&
        (el.textContent || '').trim() === 'Esporta Prenotazioni');
      let modal = title;
      for (let i = 0; modal && i < 6; i++) modal = modal.parentElement;
      out.modalText = modal ? modal.innerText.slice(0, 2500) : '(modale non trovata)';
      const grid = document.querySelector('[role="grid"]');
      let cal = grid;
      for (let i = 0; cal && i < 3; i++) cal = cal.parentElement;
      out.calendarHtml = cal ? cal.outerHTML.slice(0, 6000) : '(calendario non trovato)';
      return out;
    });
    console.error('TESTO MODALE:\n' + info.modalText);
    console.error('HTML CALENDARIO:\n' + info.calendarHtml);
    console.error('--- FINE DEBUG ---');
  } catch (e) {
    console.error('Debug non riuscito:', e.message);
  }
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
    await calendarCaption(page).waitFor({ state: 'visible', timeout: 30000 });

    console.log('Navigo alla data di inizio (' + START.day + '/' + (START.monthIndex + 1) + '/' + START.year + ')...');
    await navigateCalendarToMonth(page, START.monthIndex, START.year);
    await selectCalendarDay(page, START.day);
    try {
      console.log('Dopo il clic sulla data di inizio il range è: ' +
        (await dateRangeDisplay.textContent()).trim());
    } catch (_) { /* solo log */ }

    console.log('Navigo alla data di fine (' + END.day + '/' + (END.monthIndex + 1) + '/' + END.year + ')...');
    await navigateCalendarToMonth(page, END.monthIndex, END.year);
    await selectCalendarDay(page, END.day);

    // Il calendario resta aperto sopra la modale: lo chiudiamo cliccando
    // sul titolo (fuori dal popover), così non copre il bottone Esporta.
    // NON usiamo Escape: chiuderebbe l'intera modale.
    const calendar = calendarCaption(page);
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
    let finalExportButton = page
      .locator('div.text-md')
      .filter({ hasText: /^\s*Esporta\s*$/ })
      .last();
    if (await finalExportButton.count() === 0) {
      finalExportButton = page.getByRole('button', { name: /^\s*Esporta\s*$/ }).last();
    }
    if (await finalExportButton.count() === 0) {
      finalExportButton = page.getByText('Esporta', { exact: true }).last();
    }
    await finalExportButton.waitFor({ state: 'visible', timeout: 30000 });
    await finalExportButton.click();

    // Diamo tempo a Vikey di processare e inviare l'email
    await page.waitForTimeout(5000);

    console.log('Export completato. Vikey invierà il CSV via email a breve.');
  } catch (err) {
    console.error('Errore durante l\'export:', err && err.message ? err.message : err);
    console.error(err);
    await dumpDebug(page);
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
