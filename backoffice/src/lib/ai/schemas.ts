import { z } from "zod";

// The model TRANSCRIBES, it never CALCULATES. Every money field carries the
// literal characters the model read (`evidence`), and net/vat/gross are
// derived server-side from whichever two of {net, vat, gross} are present --
// never trusted as a triple the model itself summed. This is what makes a
// misread digit a validator failure instead of a silently wrong ledger entry.
const MoneyField = z.object({
  value: z.number().nullable(),
  evidence: z.string().nullable().describe("Το ακριβές κείμενο που διαβάσατε πάνω στο παραστατικό, π.χ. 'ΣΥΝΟΛΟ 1.240,00 €'"),
});

export const ExtractionSchema = z.object({
  doc_type: z.enum(["invoice", "receipt", "bank_slip", "other"]),
  issuer_name: z.string().nullable().describe("Όνομα εκδότη/προμηθευτή όπως αναγράφεται"),
  issuer_afm: z.string().nullable().describe("ΑΦΜ εκδότη, μόνο ψηφία"),
  invoice_number: z.string().nullable(),
  mydata_mark: z.string().nullable().describe("ΜΑΡΚ myDATA αν αναγράφεται"),
  issue_date: z.string().nullable().describe("Ημερομηνία σε μορφή ISO YYYY-MM-DD"),
  net: MoneyField,
  vat: MoneyField,
  gross: MoneyField,
  vat_rate: z.union([z.literal(0), z.literal(0.06), z.literal(0.13), z.literal(0.24)]).nullable(),
  withholding: MoneyField,
  payment_hint: z.enum(["cash", "card", "bank_transfer", "cheque", "unknown"]),
  project_mention: z.string().nullable().describe("Οτιδήποτε στο έγγραφο παραπέμπει σε συγκεκριμένο έργο -- ελεύθερο κείμενο, ΟΧΙ ID"),
  supply_number: z.string().nullable().describe("Μόνο σε λογαριασμό ΔΕΗ/ρεύματος, ΕΥΔΑΠ/νερού ή τηλεπικοινωνιών: ο αριθμός παροχής / σύνδεσης / λογαριασμού συμβολαίου ακριβώς όπως γράφεται -- αλλιώς null"),
  suggested_category: z.string().nullable().describe("Πρέπει να είναι ακριβώς ένα από τα ονόματα κατηγοριών που δόθηκαν, αλλιώς null"),
  notes_for_human: z.string().nullable().describe("Οτιδήποτε αξίζει να ελέγξει ο άνθρωπος, π.χ. 'το ΦΠΑ είναι δυσανάγνωστο'"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

// Natural-language entry ("πλήρωσα 50€ στον υδραυλικό για το Q003") -- the
// spoken/typed counterpart to photo extraction. People state what they
// handed over (gross), not net, so there's a single `amount` field instead
// of net/vat/gross -- deriveFromGross (lib/finance/money.ts) does the rest.
const NlEntrySchema = z.object({
  direction: z.enum(["income", "expense"]),
  counterparty_name: z.string().nullable().describe("Ποιος πληρώθηκε ή πλήρωσε, όπως αναφέρθηκε -- μόνο για αυτή τη συγκεκριμένη κίνηση"),
  amount: z.object({
    value: z.number().nullable(),
    evidence: z.string().nullable().describe("Η ακριβής φράση με το ποσό, π.χ. '50 ευρώ'"),
  }),
  has_invoice: z.boolean().describe("true μόνο αν αναφέρεται ρητά τιμολόγιο/απόδειξη/παραστατικό"),
  vat_rate: z.union([z.literal(0), z.literal(0.06), z.literal(0.13), z.literal(0.24)]).nullable(),
  issue_date: z.string().nullable().describe("Ημερομηνία σε ISO YYYY-MM-DD αν αναφέρθηκε (π.χ. 'χθες', 'στις 3/9'), αλλιώς null για σήμερα"),
  project_mention: z.string().nullable().describe("Οτιδήποτε παραπέμπει σε συγκεκριμένο έργο για ΑΥΤΗ την κίνηση -- ελεύθερο κείμενο, ΟΧΙ ID"),
  suggested_category: z.string().nullable().describe("Πρέπει να είναι ακριβώς ένα από τα ονόματα κατηγοριών που δόθηκαν, αλλιώς null"),
  notes_for_human: z.string().nullable(),
});

// The user often describes several expenses/incomes in one message or one
// spoken take ("50 στον υδραυλικό, 30 βενζίνη, και πήρα 200 από τον Χ") --
// each becomes its own entry with its own amount/counterparty/project so
// nothing gets merged across transactions. Single-transaction text still
// comes back as an array of length 1.
export const NlExtractionSchema = z.object({
  entries: z.array(NlEntrySchema).min(1),
});

export type NlEntry = z.infer<typeof NlEntrySchema>;
export type NlExtraction = z.infer<typeof NlExtractionSchema>;

// Revenue-estimation plans (Εκτιμήσεις Εσόδων) -- a generalised version of
// the Glyfada_Hotel_Estimation.xlsx pattern: room type x year x month, with
// occupancy%/ADR as the only real inputs. The model fills the full monthly
// grid from a short description ("8 Junior Suites at €100, 60% occupancy"),
// but never computes nights/revenue -- lib/finance/revenuePlan.ts does that
// deterministically from exactly these fields.
const MonthAssumption = z.object({
  year_number: z.number().int().min(1),
  month_number: z.number().int().min(1).max(12),
  occupancy_pct: z.number().min(0).max(1),
  adr: z.number().min(0),
});

export const RevenuePlanExtractionSchema = z.object({
  name: z.string().min(1),
  start_year: z.number().int().min(2000).max(2100),
  room_types: z
    .array(
      z.object({
        name: z.string().min(1),
        unit_count: z.number().int().positive(),
        assumptions: z.array(MonthAssumption),
      }),
    )
    .min(1),
  assumptions_note: z
    .string()
    .nullable()
    .describe("Τι υποθέσατε όπου ο χρήστης δεν έδωσε ακριβή στοιχεία, στα Ελληνικά -- π.χ. 'Θεώρησα σταθερή πληρότητα όλο τον χρόνο'"),
});

export type RevenuePlanExtraction = z.infer<typeof RevenuePlanExtractionSchema>;
