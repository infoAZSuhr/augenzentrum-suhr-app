/**
 * Glossar / Abkürzungsverzeichnis
 *
 * Wird zur Laufzeit auf SOP-Page-Content angewendet: jede Abkürzung wird
 * in <abbr title="...">…</abbr> umgewandelt, damit beim Hover ein Tooltip
 * mit der Erklärung erscheint.
 *
 * Bitte case-sensitive eintragen. Wenn ein Begriff in mehreren Varianten
 * verwendet wird (z.B. IVI / IVT / IVOM), jede Variante einzeln eintragen.
 */

export const GLOSSAR: Record<string, string> = {
  // ── App- und praxisspezifische Begriffe ───────────────────────────────────
  AZS:           'Augenzentrum Suhr',
  AKV:           'Aufgaben-Kompetenzen-Verantwortungen — Modul zur Definition von Zuständigkeiten im Team',
  SOP:           'Standard Operating Procedure — schriftliche Arbeitsanweisung / interner Standard',
  KAT:           'Katarakt (Grauer Star) — auch: KAT-OP-Bereich der Praxis',
  LID:           'Lidchirurgie — operative Eingriffe an den Augenlidern',
  IVI:           'Intravitreale Injektion — Medikamenten-Einspritzung in den Glaskörper',
  IVT:           'Intravitreale Therapie — Behandlungsserie mit IVI',
  IVOM:          'Intravitreale operative Medikamenten-Eingabe (Synonym für IVI/IVT)',
  PID:           'Patienten-Identifikationsnummer (interne Patientennummer)',
  KL:            'Kontaktlinse',
  FK:            'Fremdkörper (z.B. Hornhaut-Fremdkörper)',
  Liris:         'Liris — extern verwendete Praxis-Software für Patientenverwaltung',
  Kimenda:       'Kimenda — extern verwendete Software für Patienten-Recall-Listen',
  PIS:           'Praxis-Informations-System (z.B. Liris, Kimenda)',
  Recall:        'Patienten-Wiedereinladungs-System für regelmässige Kontrollen',
  Aufgebot:      'Schriftliche oder telefonische Einladung des Patienten zur nächsten Konsultation',
  Stornierung:   'Vorzeitiges Beenden eines Recall-Eintrags (z.B. weil Patient verstorben oder Arztwechsel)',
  Trustcenter:   'Datenverarbeitungsstelle der Versicherer, prüft Abrechnungen statistisch auf Wirtschaftlichkeit',

  // ── Einsatzplanungs-Codes (Dienstplan) ────────────────────────────────────
  GT:            'Ganztag — Mitarbeiter ist den ganzen Tag im Dienst',
  VM:            'Vormittag — Halbtags-Einsatz Vormittag',
  NM:            'Nachmittag — Halbtags-Einsatz Nachmittag',
  NFD:           'Notfalldienst',
  Fer:           'Ferien — geplante Abwesenheit (Urlaub)',
  AG:            'Ausgleich — Kompensation von Mehrarbeit / Überstunden',
  MV:            'Mutterschaft / Vaterschaft — Elternzeit',
  UZ:            'Umzug — bewilligte Abwesenheit für Wohnungswechsel',

  // ── Identifikatoren & Versicherung (Schweiz) ──────────────────────────────
  AHV:           'Alters- und Hinterlassenenversicherung — 13-stellige eindeutige Personennummer',
  'AHV-Nr':      'AHV-Nummer (Sozialversicherungs-Nummer der Schweiz, 13-stellig)',
  VEKA:          'Versicherten-Karte — schweizerische Krankenversicherten-Karte mit Chip',
  ZSR:           'Zahlstellenregister-Nummer — eindeutige Identifikation eines Leistungserbringers gegenüber Krankenversicherern',
  GLN:           'Global Location Number — internationale Identifikationsnummer für Personen, Standorte, Firmen (in Schweiz vom HCI Solutions vergeben)',
  IBAN:          'International Bank Account Number — internationale Kontonummer',

  // ── Datenschutz & Recht (zusätzlich) ──────────────────────────────────────
  DSG:           'Bundesgesetz über den Datenschutz (Schweiz)',
  DSGVO:         'Datenschutz-Grundverordnung (EU) — zusätzlich relevant bei Auslandsbezug',

  // ── Lager / Inventar ──────────────────────────────────────────────────────
  MHD:           'Mindesthaltbarkeitsdatum',
  SL:            'BAG-Spezialitätenliste — Verzeichnis der von der OKP vergüteten Arzneimittel',
  BWL:           'Bundesamt für wirtschaftliche Landesversorgung — führt die Lieferengpass-Datenbank',

  // ── Andere Spitäler / Institutionen ───────────────────────────────────────
  KSA:           'Kantonsspital Aarau',
  KSB:           'Kantonsspital Baden',
  USZ:           'UniversitätsSpital Zürich',

  // ── Tarifsystem & Recht ───────────────────────────────────────────────────
  TARDOC:        'Schweizer Einzelleistungstarif für ambulante ärztliche Leistungen (ab 01.01.2026)',
  TARMED:        'Vorgängertarif von TARDOC (gültig bis 31.12.2025)',
  APG:           'Ambulante Pauschalen — Fallpauschalen für standardisierbare ambulante Behandlungen',
  KVG:           'Bundesgesetz über die Krankenversicherung (obligatorische Grundversicherung)',
  VVG:           'Bundesgesetz über den Versicherungsvertrag (private Zusatzversicherung)',
  WZW:           'Wirksamkeit, Zweckmässigkeit, Wirtschaftlichkeit (KVG Art. 32)',
  TP:            'Taxpunkt — Bewertungseinheit im TARDOC',
  TPW:           'Taxpunktwert in CHF (kantonal verhandelt)',
  AL:            'Ärztliche Leistung (Anteil der Tarifposition)',
  TL:            'Technische Leistung (Anteil der Tarifposition für Praxisinfrastruktur)',
  LKAAT:         'Leistungskatalog ambulante Arzttarife',
  OAAT:          'Organisation ambulante Arzttarife AG',
  FMH:           'Verbindung der Schweizer Ärztinnen und Ärzte (Foederatio Medicorum Helveticorum)',
  BAG:           'Bundesamt für Gesundheit',
  SOG:           'Schweizerische Ophthalmologische Gesellschaft',
  SGAO:          'Schweizerische Gesellschaft für Augenheilkunde / -Ophthalmologie',
  SIWF:          'Schweizerisches Institut für ärztliche Weiter- und Fortbildung',
  MPA:           'Medizinische Praxisassistentin',
  GL:            'Geschäftsleitung',
  KIM:           'Kommunikation im Medizinwesen (sichere Datenübertragung)',
  PG:            'Pauschalengruppe (innerhalb einer Capitulum der ambulanten Pauschalen)',
  ICD:           'Internationale statistische Klassifikation der Krankheiten (ICD-10)',
  'ICD-10':      'Internationale statistische Klassifikation der Krankheiten, 10. Revision',
  'ICD-10-GM':   'ICD-10 German Modification — die in der Schweiz für ambulante Abrechnung verwendete Version',
  BfArM:         'Bundesinstitut für Arzneimittel und Medizinprodukte (Deutschland) — Herausgeber ICD-10-GM',

  // ── Augenmedizin – Bildgebung & Diagnostik ────────────────────────────────
  OCT:           'Optische Kohärenztomographie — bildgebende Schnittbilduntersuchung der Retina/Vorderabschnitt',
  'OCT-A':       'OCT-Angiografie — nicht-invasive Gefässdarstellung der Retina via OCT',
  SLO:           'Scanning-Laser-Ophthalmoskopie',
  HRT:           'Heidelberg Retina Tomograph (konfokale Mikroskopie)',
  GTIN:          'Global Trade Item Number — internationale Artikel-Strichcode-Nummer (z.B. EAN)',
  RVV:           'Retinaler Venenverschluss',
  RAV:           'Retinaler Arterienverschluss',
  AREDS:         'Age-Related Eye Disease Study — Nahrungsergänzungsmittel-Schema bei AMD',
  CNV:           'Choroidale Neovaskularisation',

  // ── Augenmedizin – Erkrankungen ───────────────────────────────────────────
  AMD:           'Altersbedingte Makuladegeneration',
  DR:            'Diabetische Retinopathie',
  DMÖ:           'Diabetisches Makulaödem',
  POWG:          'Primäres Offenwinkelglaukom',
  PEX:           'Pseudoexfoliations-Syndrom (Ursache für Sekundär-Glaukom und Katarakt-Komplikationen)',

  // ── Augenmedizin – Therapie & Eingriffe ───────────────────────────────────
  'Anti-VEGF':   'Anti Vascular Endothelial Growth Factor — Medikamentenklasse gegen Gefäss-Neubildung (z.B. Eylea, Lucentis, Vabysmo)',
  VEGF:          'Vascular Endothelial Growth Factor — gefässbildender Wachstumsfaktor',
  IOL:           'Intraokularlinse — Kunstlinse, die bei Katarakt-OP implantiert wird',
  MIGS:          'Minimally Invasive Glaucoma Surgery — minimal-invasive Glaukom-Chirurgie (z.B. iStent, Hydrus)',
  YAG:           'Yttrium-Aluminium-Granat-Laser (z.B. für Nachstar-Behandlung)',
  SLT:           'Selektive Lasertrabekuloplastik — Glaukom-Therapie',
  LASIK:         'Laser-in-situ-Keratomileusis — refraktiver Hornhaut-Eingriff',
  Phako:         'Phakoemulsifikation — Standard-OP-Verfahren bei Katarakt',

  // ── Untersuchungstechnik ──────────────────────────────────────────────────
  NCT:           'Non-Contact-Tonometer — kontaktlose Augendruckmessung',
  iCare:         'Markenname eines kontaktlosen Tonometers (Rebound-Tonometrie)',
  IOD:           'Intraokulärer Druck (Augeninnendruck)',
  GAT:           'Goldmann-Applanationstonometrie — Goldstandard der Augendruckmessung',

  // ── Seiten-/Anatomie-Abkürzungen ──────────────────────────────────────────
  OD:            'Oculus dexter — rechtes Auge',
  OS:            'Oculus sinister — linkes Auge',
  OU:            'Oculus uterque — beide Augen',

  // ── Allgemeinmedizin / häufige Codes ──────────────────────────────────────
  'OP':          'Operation',
  'IOL-Power':   'Berechnete Brechkraft der zu implantierenden Intraokularlinse (in Dioptrien)',
  'Visus':       'Sehschärfe',
  'Refraktion':  'Bestimmung der optischen Brechkraft des Auges (Brillenwerte)',
  'Akkommodation': 'Aktive Anpassung der Linse zur Naheinstellung',
  'Zykloplegie': 'Medikamentöse Ausschaltung der Akkommodation (z.B. mit Cyclopentolat) — nötig für objektive Refraktion bei Kindern',
  'Skiaskopie':  'Objektive Refraktionsbestimmung mittels Lichtstreifen (Retinoskopie)',
  'Refraktometer': 'Apparat zur automatischen, objektiven Refraktionsbestimmung',
  'Mydriasis':   'Pupillenerweiterung (z.B. mit Tropicamid)',
  'Funduskopie': 'Untersuchung des Augenhintergrunds (Netzhaut, Papille, Makula)',
  'Biomikroskopie': 'Untersuchung mit der Spaltlampe — feinste Details der Augenstrukturen sichtbar',
  'Spaltlampe':  'Mikroskop mit Spaltlicht zur Untersuchung der Augenstrukturen',
  'Tonometrie':  'Augeninnendruck-Messung',
  'Applanation': 'Augendruckmessung durch leichtes Andrücken der Hornhaut (Goldmann-Tonometrie)',
  'Pachymetrie': 'Messung der Hornhautdicke (wichtig u.a. für Glaukom-Diagnostik)',
  'Perimetrie':  'Gesichtsfeld-Untersuchung (z.B. zur Glaukom-Verlaufskontrolle)',
  'Indentation': 'Skleraindentation — Eindrücken der Lederhaut zur Untersuchung der Netzhautperipherie',
  'Angiografie': 'Gefässdarstellung — bei Augen meist mit Fluoreszein (FLA) oder Indocyaningrün (ICG)',
  'Fluoreszein': 'Gelbgrüner Farbstoff zur Gefäss- und Netzhautdiagnostik (Fluoreszein-Angiografie)',
  'Strabismus':  'Schielen — Fehlstellung der Augen',
  'Diplopie':    'Doppelbilder — Sehen eines Objekts als zwei',
  'Nystagmus':   'Augenzittern — unwillkürliche, rhythmische Augenbewegungen',
  'Amblyopie':   'Schwachsichtigkeit — meist Folge einer unbehandelten Sehstörung im Kindesalter',
  'Pterygium':   'Flügelfell — gutartige Bindehaut-Wucherung über die Hornhaut',
  'Chalazion':   'Hagelkorn — chronisch entzündete Talgdrüse am Lidrand',
  'Hordeolum':   'Gerstenkorn — akut entzündete Drüse am Lid',
  'Blepharitis': 'Entzündung der Lidränder',
  'Konjunktivitis': 'Bindehautentzündung',
  'Keratitis':   'Hornhautentzündung',
  'Uveitis':     'Entzündung der mittleren Augenhaut (Iris, Ziliarkörper, Aderhaut)',
  'Iridozyklitis': 'Uveitis anterior — Entzündung von Iris und Ziliarkörper',
  'Endophthalmitis': 'Schwere Entzündung im Augeninneren (Komplikation z.B. nach IVI oder OP)',
  'Phako':       'Phakoemulsifikation — Standard-Operationstechnik bei Katarakt',
  'Nachstar':    'Nachtrübung der hinteren Linsenkapsel nach Katarakt-OP — wird mit YAG-Laser behandelt',
  'Charge':      'Lot / Bestand-Charge eines Medikaments oder Materials',
  'Sparte':      'TARDOC-Begriff: zusammengehörige Leistungsbereiche, die einen Raumwechsel auslösen können',
  'Capitulum':   'TARDOC-Begriff: Kapitel der ambulanten Pauschalen (z.B. Capitulum 02 = Auge)',
  'Pauschale':   'Tarif-Form: fester Betrag für eine standardisierte Leistung (statt Einzelpositionen)',
  'Dignität':    'TARDOC-Begriff: Qualitative Berechtigung — welche Facharzttitel eine Leistung abrechnen dürfen',

  // ── Datenquellen / Listen ──────────────────────────────────────────────────
  'Spezialitätenliste': 'BAG-SL — Liste der von der OKP vergüteten Arzneimittel',
  'Refdata':     'Schweizer Artikelstamm (von HCI Solutions) — Stammdaten für Medikamente und Medizinprodukte',
  'Lieferengpass': 'Vom BWL gemeldeter aktueller Engpass bei einem Arzneimittel',
  'Nota-Liste':  'Liste von Medikamenten, die Zur Rose aktuell nicht oder verzögert liefern kann',
}
