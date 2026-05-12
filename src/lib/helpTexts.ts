export interface HelpEntry {
  title: string
  text: string
  section?: string // anchor on /hilfe page
}

// Fallback help per page path (hash-based routing)
export const PAGE_HELP: Record<string, HelpEntry> = {
  '':         { title: 'Dashboard', text: 'Die Startseite zeigt eine Übersicht der wichtigsten Informationen: geplante IVI- und KAT-Tage, Lager-Warnungen und die kommenden Einsatzwochen.', section: 'dashboard' },
  '/':        { title: 'Dashboard', text: 'Die Startseite zeigt eine Übersicht der wichtigsten Informationen: geplante IVI- und KAT-Tage, Lager-Warnungen und die kommenden Einsatzwochen.', section: 'dashboard' },
  '/ivom':    { title: 'IVI-Verwaltung', text: 'Verwaltung der intravitrealen Injektionen (IVI). Hier werden Patienten, Termine und Behandlungshistorie verwaltet.', section: 'op' },
  '/lid':     { title: 'Lid-Operationen', text: 'Verwaltung von Lidoperationen. Patientendaten und OP-Planung für Lideingriffe.', section: 'op' },
  '/kat':     { title: 'KAT-Operationen', text: 'Verwaltung von Kataraktoperationen (KAT). Patienten, die im KSA operiert werden, erscheinen als KAT-Tage im Dashboard.', section: 'op' },
  '/lager':   { title: 'Lager', text: 'Medikamenten- und Materialbestand. Zeigt Warnungen bei niedrigem Bestand oder abgelaufenen Artikeln.', section: 'lager' },
  '/planung': { title: 'Einsatzplanung', text: 'Monats- und Jahresübersicht der Arzt- und MPA-Einsätze. Admins können Einträge bearbeiten, Mitarbeiter können über "Mein Bereich" Anträge stellen.', section: 'planung' },
  '/admin/users': { title: 'Benutzerverwaltung', text: 'Benutzerkonten verwalten: Benutzer hinzufügen, Rollen zuweisen und Konten aktivieren/deaktivieren.', section: 'benutzer' },
  '/hilfe':   { title: 'Benutzerhandbuch', text: 'Das Benutzerhandbuch erklärt alle Funktionen der App. Nutzen Sie das Inhaltsverzeichnis oben um direkt zu einem Thema zu springen.' },
}

export const HELP_TEXTS: Record<string, HelpEntry> = {
  // Navigation
  'nav-op': {
    title: 'OP-Bereich',
    text: 'Zugang zu den drei OP-Verwaltungsbereichen: IVI (Intravitreale Injektion), Lid-Operationen und KAT (Kataraktoperationen).',
    section: 'op',
  },
  'nav-lager': {
    title: 'Lager',
    text: 'Medikamenten- und Materialbestand verwalten. Zeigt Warnungen bei niedrigem Bestand oder abgelaufenen Artikeln.',
    section: 'lager',
  },
  'nav-planung': {
    title: 'Einsatzplanung',
    text: 'Monats- und Jahresübersicht der Arzteinsätze und MPA-Einsätze. Admins können Einträge bearbeiten, Mitarbeiter können Anträge stellen.',
    section: 'planung',
  },
  'nav-benutzer': {
    title: 'Benutzerverwaltung',
    text: 'Benutzerkonten verwalten: neue Benutzer hinzufügen, Rollen zuweisen (Admin, Arzt, MPA, Gast) und Konten aktivieren/deaktivieren.',
    section: 'benutzer',
  },

  // Header
  'header-bell': {
    title: 'Benachrichtigungen',
    text: 'Zeigt ausstehende Anfragen: neue Registrierungen, Planungsanträge (Ferien, Tausch, Absage/Änderung), Passwort-Reset-Anfragen und Nachrichten über das Kontaktformular.',
    section: 'benachrichtigungen',
  },
  'header-user': {
    title: 'Benutzerprofil',
    text: 'Zeigt Ihren Namen und Ihre Rolle. Klicken Sie hier für Profileinstellungen (Passwort ändern) oder zum Abmelden.',
    section: 'profil',
  },
  'header-help': {
    title: 'Hilfe-Modus',
    text: 'Sie befinden sich im Hilfe-Modus. Klicken Sie auf ein beliebiges Element um eine Erklärung zu erhalten. Klicken Sie erneut auf diesen Button zum Beenden.',
  },

  // Dashboard
  'dashboard-ivi': {
    title: 'Geplante IVI-Tage',
    text: 'Zeigt die nächsten Tage mit geplanten intravitrealen Injektionen, inklusive Patientenzahl und zuständigen Ärzten.',
    section: 'dashboard',
  },
  'dashboard-kat': {
    title: 'KAT-Tage (OP KSA)',
    text: 'Zeigt kommende Tage, an denen Ärzte im KSA (Kantonsspital Aarau) für Kataraktoperationen eingeplant sind.',
    section: 'dashboard',
  },
  'dashboard-lager': {
    title: 'Lager-Warnungen',
    text: 'Anzahl der aktiven Lager-Warnungen. Kritische Warnungen (rot) bedeuten, dass ein Artikel sofort nachbestellt werden muss.',
    section: 'lager',
  },
  'dashboard-wochen': {
    title: 'Einsatzplanung (Wochen)',
    text: 'Scrollbare Wochenübersicht der Arzteinsätze. Zeigt Kalenderwoche, Datum, Ärzte mit Einsatzcode und IVI-Patientenzahl. Mit "+ 4 Wochen" weitere Wochen laden.',
    section: 'planung',
  },

  // Einsatzplanung
  'planung-monatsansicht': {
    title: 'Monatsansicht',
    text: 'Zeigt alle Einsätze des aktuellen Monats in einer Tabellenform. Jede Zeile ist ein Tag, jede Spalte ein Mitarbeiter.',
    section: 'planung',
  },
  'planung-jahresansicht': {
    title: 'Jahresansicht',
    text: 'Scrollbare Übersicht aller Monate des Jahres. Feiertage sind orange markiert, Wochenenden grau.',
    section: 'planung',
  },
  'planung-drucken': {
    title: 'Drucken',
    text: 'Druckt die aktuelle Monats- oder Jahresansicht auf einer DIN-A4-Seite (Querformat). Die Grösse wird automatisch angepasst.',
    section: 'planung',
  },
  'planung-feiertage': {
    title: 'Feiertage verwalten',
    text: 'Admins können Feiertage für das aktuelle Jahr hinzufügen oder entfernen. Feiertage werden in der Planung und im Dashboard orange hervorgehoben.',
    section: 'feiertage',
  },
  'planung-meinbereich': {
    title: 'Mein Bereich',
    text: 'Persönlicher Bereich für Mitarbeiter: eigene Einsätze und Abwesenheiten einsehen, Abwesenheitsanträge stellen, Tausch- oder Änderungsanfragen senden und den Status eigener Anträge verfolgen.',
    section: 'mein-bereich',
  },

  // Mein Bereich
  'meinbereich-ferien': {
    title: 'Absenheitsmeldung',
    text: 'Abwesenheitsantrag einreichen: Ferien, Weiterbildung, Ausgleich, Militär/Zivildienst oder andere Abwesenheit. Zeitraum und optionale Bemerkung angeben. Der Admin wird benachrichtigt.',
    section: 'absenheitsmeldung',
  },
  'meinbereich-tauschen': {
    title: 'Einsatz tauschen',
    text: 'Zwei Modi: "Wunschdatum" (Eintrag auf einen anderen Tag verschieben) oder "Mit Mitarbeiter" (direkter Tausch mit einem Kollegen an einem bestimmten Datum).',
    section: 'tausch',
  },
  'meinbereich-aendern': {
    title: 'Einsatz ändern / absagen',
    text: 'Änderungsanfrage für einen bestehenden Einsatz. Wählen Sie einen neuen Code (z.B. K = Krank) oder lassen Sie das Feld leer für eine vollständige Absage. Optional: Begründung hinterlassen.',
    section: 'aenderung',
  },
  'meinbereich-antraege': {
    title: 'Meine Anträge',
    text: 'Übersicht aller eigenen Anträge mit vollständigen Details und aktuellem Status: Ausstehend, Genehmigt, Provisorisch, Abgelehnt, Anpassung nötig, Storniert. Vergangene genehmigte Anträge werden automatisch ausgeblendet.',
    section: 'antraege-tab',
  },

  // Login
  'login-kontakt': {
    title: 'Administrator kontaktieren',
    text: 'Kontaktformular für nicht eingeloggte Benutzer. Wählen Sie das Anliegen (Loginanfrage, Passwort zurücksetzen oder Andere). Die Nachricht erscheint beim Admin als Benachrichtigung.',
    section: 'login',
  },
  'login-passwort': {
    title: 'Passwort vergessen',
    text: 'Passwort-Reset-Anfrage senden. Geben Sie Ihren Benutzernamen oder Ihre E-Mail-Adresse ein. Der Admin wird benachrichtigt und sendet Ihnen eine Reset-E-Mail.',
    section: 'login',
  },
}
