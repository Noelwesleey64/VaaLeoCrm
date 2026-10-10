import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Database from "@tauri-apps/plugin-sql";
import formDesign from "../Form design.jpg";
import { supabase, supabaseConfigured } from "./lib/supabase";
import {
  allocateCustomerNumberOnline,
  deleteRecordOnline,
  syncRecords,
  upsertRecordOnline,
} from "./lib/sync";
import "./App.css";

type ImageAttachment = {
  name: string;
  dataUrl: string;
};

type FormState = {
  id: string;
  name: string;
  colour: string;
  garmentStyle: string;
  tel: string;
  recordNumber: string;
  date: string;
  measurements: Record<string, string>;
  designImages: ImageAttachment[];
  fabricImages: ImageAttachment[];
  notes: string;
  collectionDate: string;
  recordedIn: string;
  approval: string;
};

type StoredRecord = {
  id: string;
  name: string;
  colour: string | null;
  garment_style: string | null;
  tel: string | null;
  record_number: string | null;
  date: string | null;
  measurements_json: string;
  design_images_json: string;
  fabric_images_json: string;
  notes: string | null;
  collection_date: string | null;
  recorded_in: string | null;
  approval: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string | null;
  last_synced_at: string | null;
  deleted_at: string | null;
};

type RecordSummary = {
  id: string;
  name: string;
  colour: string | null;
  garment_style: string | null;
  tel: string | null;
  record_number: string | null;
  date: string | null;
  updated_at: string;
};

const measurementItems = [
  ["headCircumference", "Head Circumference"],
  ["neckCircumference", "Neck Circumference"],
  ["neckDropFront", "Neck Drop Front"],
  ["neckDropBack", "Neck Drop Back"],
  ["shoulders", "Shoulders"],
  ["offShoulder", "Off Shoulder"],
  ["topUpperBust", "Top / Upper Bust"],
  ["bustChest", "Bust / Chest"],
  ["underBust", "Under Bust"],
  ["bustPoint", "Bust Point"],
  ["shoulderToUnderbust", "Shoulder To Underbust"],
  ["bustCupSize", "Bust Cup Size"],
  ["armholeDepth", "Arm hole Depth"],
  ["bodice", "Bodice"],
  ["centerBackBodice", "Center Back Bodice"],
  ["shoulderToHipline", "Shoulder To Hipline"],
  ["shoulderToMidThigh", "Shoulder To Mid Thigh"],
  ["shoulderToAboveKnee", "Shoulder To Above Knee"],
  ["waist", "Waist"],
  ["lowWaist", "Low Waist"],
  ["waistToHipline", "Waist To Hipline"],
  ["waistToMidThigh", "Waist To Mid Thigh"],
  ["waistToAboveKnee", "Waist To Above Knee"],
  ["highHips", "High Hips"],
  ["hips", "Hips"],
  ["underHip", "Under Hip"],
  ["sleevesFullLength", "Sleeves Full Length"],
  ["cupSleevesCircumference", "Cup Sleeves Circumference"],
  ["sleevesArmCircumference", "Sleeves Arm Circumference (Bicep)"],
  ["sleevesThreeQuarter", "Sleeves 3/4 Circumference"],
  ["wristCircumference", "Wrist Circumference"],
  ["thigh", "Thigh"],
  ["crotchLine", "Crotch Line"],
  ["knee", "Knee"],
  ["bottomLegOpening", "Bottom Leg Opening"],
  ["frontRise", "Front Rise"],
  ["backRise", "Back Rise"],
  ["lengthInseam", "Length Inseam"],
  ["fullLengthTrouserOutseam", "Full Length Trouser Outseam"],
  ["fullLengthShorts", "Full Length Shorts"],
  ["fullLengthTopShirt", "Full Length Top / Shirt"],
  ["fullLengthTopHighLow", "Full Length Top High Low"],
  ["fullLengthSkirt", "Full Length Skirt"],
  ["fullLengthSkirtHighLow", "Full Length Skirt High Low"],
  ["fullLengthDress", "Full Length Dress"],
  ["fullLengthDressHighLow", "Full Length Dress High Low"],
  ["fullLengthJacket", "Full Length Jacket"],
] as const;

const measurementGroups = [
  { label: "Upper body", items: measurementItems.slice(0, 18) },
  { label: "Waist & hip", items: measurementItems.slice(18, 26) },
  { label: "Sleeves", items: measurementItems.slice(26, 31) },
  { label: "Trouser / shorts", items: measurementItems.slice(31, 40) },
  { label: "Garment lengths", items: measurementItems.slice(40, 47) },
] as const;

const emptyMeasurements = () =>
  Object.fromEntries(measurementItems.map(([key]) => [key, ""]));

const newForm = (): FormState => ({
  id: crypto.randomUUID(),
  name: "",
  colour: "",
  garmentStyle: "",
  tel: "",
  recordNumber: "",
  date: "",
  measurements: emptyMeasurements(),
  designImages: [],
  fabricImages: [],
  notes: "",
  collectionDate: "",
  recordedIn: "",
  approval: "",
});

const isTauri = () =>
  Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const measurementTableSql = `CREATE TABLE IF NOT EXISTS measurement_records (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  colour TEXT,
  garment_style TEXT,
  tel TEXT,
  record_number TEXT,
  date TEXT,
  measurements_json TEXT NOT NULL,
  design_images_json TEXT NOT NULL,
  fabric_images_json TEXT NOT NULL,
  notes TEXT,
  collection_date TEXT,
  recorded_in TEXT,
  approval TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  deleted_at TEXT
)`;

const ensureDatabaseSchema = async (db: Database) => {
  await db.execute(measurementTableSql);
  const migrations = [
    "ALTER TABLE measurement_records ADD COLUMN recorded_in TEXT",
    "ALTER TABLE measurement_records ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE measurement_records ADD COLUMN last_synced_at TEXT",
    "ALTER TABLE measurement_records ADD COLUMN deleted_at TEXT",
  ];
  for (const migration of migrations) {
    try {
      await db.execute(migration);
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column name")) throw error;
    }
  }
};

const recordToForm = (row: StoredRecord): FormState => ({
  id: row.id,
  name: row.name,
  colour: row.colour ?? "",
  garmentStyle: row.garment_style ?? "",
  tel: row.tel ?? "",
  recordNumber: row.record_number ?? "",
  date: row.date ?? "",
  measurements: {
    ...emptyMeasurements(),
    ...parseJson<Record<string, string>>(row.measurements_json, {}),
  },
  designImages: parseJson<ImageAttachment[]>(row.design_images_json, []),
  fabricImages: parseJson<ImageAttachment[]>(row.fabric_images_json, []),
  notes: row.notes ?? "",
  collectionDate: row.collection_date ?? "",
  recordedIn: row.recorded_in ?? "",
  approval: row.approval ?? "",
});

const recordToSummary = (row: StoredRecord): RecordSummary => ({
  id: row.id,
  name: row.name,
  colour: row.colour,
  garment_style: row.garment_style,
  tel: row.tel,
  record_number: row.record_number,
  date: row.date,
  updated_at: row.updated_at,
});

const recordMatches = (record: RecordSummary, query: string) =>
  [record.name, record.tel, record.record_number, record.garment_style, record.colour]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);

const isGeneratedCustomerNumber = (value: string | null | undefined) => {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]{0,5}$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
};

function App() {
  const [form, setForm] = useState<FormState>(newForm);
  const [database, setDatabase] = useState<Database | null>(null);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [browserRecords, setBrowserRecords] = useState<StoredRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeView, setActiveView] = useState<"form" | "records" | "detail">("form");
  const [selectedRecord, setSelectedRecord] = useState<FormState | null>(null);
  const [status, setStatus] = useState("Ready for a new measurement record");
  const [isSaving, setIsSaving] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authLoading, setAuthLoading] = useState(supabaseConfigured);
  const [syncStatus, setSyncStatus] = useState(
    supabaseConfigured ? "Sign in to enable online sync" : "Add Supabase settings to enable sync",
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [viewerImage, setViewerImage] = useState<ImageAttachment | null>(null);

  const recordLabel = useMemo(
    () => form.name.trim() || "New customer record",
    [form.name],
  );

  const matchingRecords = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return query ? records.filter((record) => recordMatches(record, query)) : records;
  }, [records, searchTerm]);

  const visibleRecords = matchingRecords.slice(0, 20);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setAuthLoading(false);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedRecord() {
      try {
        if (!isTauri()) {
          const savedRecords = parseJson<StoredRecord[]>(
            localStorage.getItem("vaaleo-records"),
            [],
          );
          const legacyRecord = localStorage.getItem("vaaleo-latest-record");
          const allRecords = savedRecords.length
            ? savedRecords
            : legacyRecord
              ? [parseJson<StoredRecord>(legacyRecord, newForm() as unknown as StoredRecord)]
              : [];
          if (!cancelled) {
            setBrowserRecords(allRecords);
            setRecords(allRecords.map(recordToSummary));
            if (allRecords[0]) setForm(recordToForm(allRecords[0]));
          }
          return;
        }

        const db = await Database.load("sqlite:vaaleo.db");
        await ensureDatabaseSchema(db);
        if (cancelled) return;
        setDatabase(db);
        const rows = await db.select<RecordSummary[]>(
          "SELECT id, name, colour, garment_style, tel, record_number, date, updated_at FROM measurement_records WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        );
        if (!cancelled) setRecords(rows);
        const latest = rows[0];
        if (latest && !cancelled) {
          const fullRows = await db.select<StoredRecord[]>(
            "SELECT * FROM measurement_records WHERE id = $1 LIMIT 1",
            [latest.id],
          );
          if (fullRows[0]) setForm(recordToForm(fullRows[0]));
          setStatus("Loaded the last saved record");
        }
      } catch (error) {
        console.error(error);
        setStatus(
          isTauri()
            ? "SQLite could not be opened — try saving again"
            : "SQLite is not available in browser preview — local preview storage is active",
        );
      }
    }

    void loadSavedRecord();
    return () => {
      cancelled = true;
    };
  }, []);

  const openRecord = async (summary: RecordSummary) => {
    try {
      let row: StoredRecord | undefined;
      if (isTauri() && database) {
        const rows = await database.select<StoredRecord[]>(
          "SELECT * FROM measurement_records WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
          [summary.id],
        );
        row = rows[0];
      } else {
        row = browserRecords.find((record) => record.id === summary.id);
      }

      if (!row) throw new Error("Record not found");
      const openedRecord = recordToForm(row);
      setForm(openedRecord);
      setSelectedRecord(openedRecord);
      setSearchTerm("");
      setActiveView("detail");
      setStatus(`Viewing ${row.name || "saved measurement record"}`);
    } catch (error) {
      console.error(error);
      setStatus("Could not open that record");
    }
  };

  const syncNow = async () => {
    if (!supabaseConfigured || !supabase) {
      setSyncStatus("Add Supabase settings to enable sync");
      return;
    }
    if (!session) {
      setSyncStatus("Sign in to enable online sync");
      return;
    }
    if (!isTauri()) {
      setSyncStatus("Sync is available in the installed Windows app");
      return;
    }

    setIsSyncing(true);
    setSyncStatus("Syncing with Supabase…");
    try {
      let activeDatabase = database;
      if (!activeDatabase) {
        activeDatabase = await Database.load("sqlite:vaaleo.db");
        await ensureDatabaseSchema(activeDatabase);
        setDatabase(activeDatabase);
      }

      const result = await syncRecords(activeDatabase, session.user.id);
      const rows = await activeDatabase.select<RecordSummary[]>(
        "SELECT id, name, colour, garment_style, tel, record_number, date, updated_at FROM measurement_records WHERE deleted_at IS NULL ORDER BY updated_at DESC",
      );
      setRecords(rows);
      setSyncStatus(`Synced · ${result.uploaded} uploaded · ${result.downloaded} available online`);
    } catch (error) {
      console.error(error);
      setSyncStatus(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (session && database) void syncNow();
  }, [session, database]);

  useEffect(() => {
    if (!session) return;

    const handleOnline = () => {
      if (isTauri()) void syncNow();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [session, database]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setSyncStatus(authMode === "sign-in" ? "Signing in…" : "Creating account…");
    const result = authMode === "sign-in"
      ? await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword })
      : await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword });

    if (result.error) {
      setSyncStatus(result.error.message);
      return;
    }

    setAuthPassword("");
    setSyncStatus(
      authMode === "sign-up" && !result.data.session
        ? "Account created — check your email to confirm it"
        : "Signed in — sync will start shortly",
    );
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setSyncStatus("Signed out · local records remain available offline");
  };

  const updateField = (
    field: keyof Omit<FormState, "measurements" | "designImages" | "fabricImages" | "id">,
    value: string,
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateMeasurement = (key: string, value: string) => {
    setForm((current) => ({
      ...current,
      measurements: { ...current.measurements, [key]: value },
    }));
  };

  const readImages = (files: File[]) =>
    Promise.all(
      files.map(
        (file) =>
          new Promise<ImageAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );

  const handleImages = async (
    event: ChangeEvent<HTMLInputElement>,
    target: "designImages" | "fabricImages",
  ) => {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    const images = await readImages(files);
    setForm((current) => ({ ...current, [target]: [...current[target], ...images] }));
    event.target.value = "";
  };

  const removeImage = (target: "designImages" | "fabricImages", index: number) => {
    setForm((current) => ({
      ...current,
      [target]: current[target].filter((_, imageIndex) => imageIndex !== index),
    }));
  };

  const getNextCustomerNumber = async (databaseOverride?: Database | null) => {
    let activeDatabase = databaseOverride ?? database;
    if (isTauri() && !activeDatabase) {
      activeDatabase = await Database.load("sqlite:vaaleo.db");
      await ensureDatabaseSchema(activeDatabase);
      setDatabase(activeDatabase);
    }

    const values: string[] = [];
    if (activeDatabase) {
      const rows = await activeDatabase.select<Array<{ record_number: string | null }>>(
        "SELECT record_number FROM measurement_records",
      );
      values.push(...rows.map((row) => row.record_number ?? ""));
    } else {
      values.push(...browserRecords.map((record) => record.record_number ?? ""));
    }

    const highestNumber = values.reduce((highest, value) => {
      if (!isGeneratedCustomerNumber(value)) return highest;
      return Math.max(highest, Number(value));
    }, 0);
    return String(highestNumber + 1);
  };

  useEffect(() => {
    if (!session || activeView !== "form" || selectedRecord || form.recordNumber) return;

    const draftId = form.id;
    void (async () => {
      let recordNumber = "";
      const canAllocateOnline = Boolean(
        isTauri() && supabaseConfigured && navigator.onLine !== false,
      );

      if (canAllocateOnline) {
        try {
          recordNumber = await allocateCustomerNumberOnline();
        } catch (error) {
          console.warn("Online customer number allocation failed; using local numbering", error);
        }
      }

      if (!recordNumber) recordNumber = await getNextCustomerNumber();
      setForm((current) =>
        current.id === draftId && !current.recordNumber
          ? { ...current, recordNumber }
          : current,
      );
    })();
  }, [activeView, database, form.id, form.recordNumber, selectedRecord, session]);

  const saveRecord = async () => {
    setIsSaving(true);
    setStatus("Saving measurement record…");
    const now = new Date().toISOString();
    const existingBrowserRecord = browserRecords.find((record) => record.id === form.id);
    let onlineSaveError: unknown = null;
    let savedOnline = false;
    try {
      let activeDatabase = database;
      if (isTauri() && !activeDatabase) {
        activeDatabase = await Database.load("sqlite:vaaleo.db");
        await ensureDatabaseSchema(activeDatabase);
        setDatabase(activeDatabase);
      }

      if (activeDatabase) await ensureDatabaseSchema(activeDatabase);

      const canSaveOnline = Boolean(
        isTauri() && session && supabaseConfigured && navigator.onLine !== false,
      );
      let recordNumber = form.recordNumber.trim();
      if (!recordNumber && canSaveOnline) {
        try {
          recordNumber = await allocateCustomerNumberOnline();
        } catch (error) {
          onlineSaveError = error;
        }
      }
      if (!recordNumber) recordNumber = await getNextCustomerNumber(activeDatabase);
      const saveForm = { ...form, recordNumber };
      if (form.recordNumber !== recordNumber) {
        setForm((current) => ({ ...current, recordNumber }));
      }

      let savedRecord: StoredRecord = {
        id: saveForm.id,
        name: saveForm.name,
        colour: saveForm.colour,
        garment_style: saveForm.garmentStyle,
        tel: saveForm.tel,
        record_number: saveForm.recordNumber,
        date: saveForm.date,
        measurements_json: JSON.stringify(saveForm.measurements),
        design_images_json: JSON.stringify(saveForm.designImages),
        fabric_images_json: JSON.stringify(saveForm.fabricImages),
        notes: saveForm.notes,
        collection_date: saveForm.collectionDate,
        recorded_in: saveForm.recordedIn,
        approval: saveForm.approval,
        created_at: existingBrowserRecord?.created_at ?? now,
        updated_at: now,
        sync_status: "pending",
        last_synced_at: existingBrowserRecord?.last_synced_at ?? null,
        deleted_at: null,
      };

      if (canSaveOnline && !onlineSaveError && session) {
        try {
          await upsertRecordOnline(savedRecord, session.user.id);
          savedOnline = true;
          savedRecord = {
            ...savedRecord,
            sync_status: "synced",
            last_synced_at: now,
          };
        } catch (error) {
          onlineSaveError = error;
        }
      }

      if (!isTauri()) {
        const nextBrowserRecords = [
          savedRecord,
          ...browserRecords.filter((record) => record.id !== saveForm.id),
        ];
        setBrowserRecords(nextBrowserRecords);
        setRecords(nextBrowserRecords.map(recordToSummary));
        localStorage.setItem("vaaleo-records", JSON.stringify(nextBrowserRecords));
        localStorage.setItem("vaaleo-latest-record", JSON.stringify(savedRecord));
      } else if (activeDatabase) {
        await activeDatabase.execute(
          `INSERT INTO measurement_records
            (id, name, colour, garment_style, tel, record_number, date, measurements_json,
             design_images_json, fabric_images_json, notes, collection_date, recorded_in, approval,
             created_at, updated_at, sync_status, last_synced_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             colour = excluded.colour,
             garment_style = excluded.garment_style,
             tel = excluded.tel,
             record_number = excluded.record_number,
             date = excluded.date,
             measurements_json = excluded.measurements_json,
             design_images_json = excluded.design_images_json,
             fabric_images_json = excluded.fabric_images_json,
             notes = excluded.notes,
             collection_date = excluded.collection_date,
             recorded_in = excluded.recorded_in,
             approval = excluded.approval,
             updated_at = excluded.updated_at,
             sync_status = excluded.sync_status,
             last_synced_at = excluded.last_synced_at,
             deleted_at = NULL`,
          [
            saveForm.id,
            saveForm.name,
            saveForm.colour,
            saveForm.garmentStyle,
            saveForm.tel,
            saveForm.recordNumber,
            saveForm.date,
            JSON.stringify(saveForm.measurements),
            JSON.stringify(saveForm.designImages),
            JSON.stringify(saveForm.fabricImages),
            saveForm.notes,
            saveForm.collectionDate,
            saveForm.recordedIn,
            saveForm.approval,
            now,
            now,
            savedRecord.sync_status,
            savedRecord.last_synced_at,
            null,
          ],
        );
        setRecords((current) => [
          recordToSummary(savedRecord),
          ...current.filter((record) => record.id !== savedRecord.id),
        ]);
      } else {
        throw new Error("SQLite connection was not available");
      }
      if (onlineSaveError) {
        const message = onlineSaveError instanceof Error ? onlineSaveError.message : String(onlineSaveError);
        setSyncStatus(`Sync failed: ${message}`);
        setStatus(`Saved offline at ${new Date().toLocaleTimeString()}`);
      } else if (savedOnline) {
        setSyncStatus("Online · saved and backed up locally");
        setStatus(`Saved online and backed up locally at ${new Date().toLocaleTimeString()}`);
      } else {
        setStatus(`Saved locally at ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : (() => {
                try {
                  return JSON.stringify(error);
                } catch {
                  return String(error);
                }
              })();
      setStatus(`Could not save this record: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setForm(newForm());
    setSelectedRecord(null);
    setSearchTerm("");
    setActiveView("form");
    setStatus("Started a new measurement record");
  };

  const deleteRecord = async (record: FormState) => {
    const displayName = record.name.trim() || "this customer record";
    if (!window.confirm(`Delete ${displayName}? This action cannot be undone.`)) return;

    setStatus("Deleting measurement record…");
    const deletedAt = new Date().toISOString();
    let onlineDeleteError: unknown = null;
    let deletedOnline = false;
    try {
      if (isTauri() && session && supabaseConfigured && navigator.onLine !== false) {
        try {
          await deleteRecordOnline(record.id, session.user.id, deletedAt);
          deletedOnline = true;
        } catch (error) {
          onlineDeleteError = error;
        }
      }

      let activeDatabase = database;
      if (isTauri() && !activeDatabase) {
        activeDatabase = await Database.load("sqlite:vaaleo.db");
        setDatabase(activeDatabase);
      }

      if (activeDatabase) {
        await activeDatabase.execute(
          "UPDATE measurement_records SET deleted_at = $1, sync_status = $2, last_synced_at = $3, updated_at = $1 WHERE id = $4",
          [deletedAt, deletedOnline ? "synced" : "pending", deletedOnline ? deletedAt : null, record.id],
        );
      } else if (isTauri()) {
        throw new Error("SQLite connection was not available");
      }

      const remainingBrowserRecords = browserRecords.filter((item) => item.id !== record.id);
      if (!isTauri()) {
        setBrowserRecords(remainingBrowserRecords);
        localStorage.setItem("vaaleo-records", JSON.stringify(remainingBrowserRecords));
        const latest = remainingBrowserRecords[0];
        if (latest) localStorage.setItem("vaaleo-latest-record", JSON.stringify(latest));
        else localStorage.removeItem("vaaleo-latest-record");
      }

      setRecords((current) => current.filter((item) => item.id !== record.id));
      setSelectedRecord(null);
      setForm(newForm());
      setActiveView("records");
      if (onlineDeleteError) {
        const message = onlineDeleteError instanceof Error ? onlineDeleteError.message : String(onlineDeleteError);
        setSyncStatus(`Sync failed: ${message}`);
        setStatus(`Deleted locally; online deletion pending`);
      } else if (deletedOnline) {
        setSyncStatus("Online · deletion saved and backed up locally");
        setStatus(`Deleted ${displayName} online and locally`);
      } else {
        setStatus(`Deleted ${displayName} locally`);
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Could not delete this record: ${message}`);
    }
  };

  const input = (
    field: keyof Omit<FormState, "measurements" | "designImages" | "fabricImages" | "id">,
    className: string,
    style: React.CSSProperties,
    placeholder = "",
  ) => (
    <input
      className={`paper-input ${className}`}
      style={style}
      value={form[field]}
      onChange={(event) => updateField(field, event.target.value)}
      placeholder={placeholder}
      readOnly={field === "recordNumber"}
      aria-label={field}
    />
  );

  if (authLoading || !session) {
    return (
      <AuthScreen
        configured={supabaseConfigured}
        loading={authLoading}
        email={authEmail}
        password={authPassword}
        mode={authMode}
        status={syncStatus}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onModeChange={setAuthMode}
        onSubmit={submitAuth}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="app-toolbar">
        <div>
          <p className="toolbar-kicker">VAALEO DESIGNS</p>
          <h1>Measurement records</h1>
          <p className="toolbar-status">{status}</p>
        </div>
        <div className="toolbar-actions">
          <span className="record-name">{recordLabel}</span>
        </div>
      </header>

      <SyncBar
        configured={supabaseConfigured}
        session={session}
        email={authEmail}
        password={authPassword}
        mode={authMode}
        status={syncStatus}
        isSyncing={isSyncing}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onModeChange={setAuthMode}
        onSubmit={submitAuth}
        onSync={() => void syncNow()}
        onSignOut={() => void signOut()}
      />

      <ImageViewer image={viewerImage} onClose={() => setViewerImage(null)} />

      <nav className="view-tabs" aria-label="Application screens">
        <button
          className={activeView === "form" ? "view-tab active" : "view-tab"}
          type="button"
          onClick={() => setActiveView("form")}
        >
          Measurement form
        </button>
        <button
          className={activeView === "records" || activeView === "detail" ? "view-tab active" : "view-tab"}
          type="button"
          onClick={() => setActiveView("records")}
        >
          Manage records <span>{records.length}</span>
        </button>
      </nav>

      {activeView === "records" ? (
        <RecordsManager
          records={matchingRecords}
          totalRecords={records.length}
          searchTerm={searchTerm}
          onSearch={setSearchTerm}
          onOpen={(record) => void openRecord(record)}
          onNew={resetForm}
        />
      ) : activeView === "detail" && selectedRecord ? (
        <RecordDetail
          record={selectedRecord}
          onBack={() => setActiveView("records")}
          onDelete={() => void deleteRecord(selectedRecord)}
          onViewImage={setViewerImage}
          onEdit={() => {
            setForm(selectedRecord);
            setActiveView("form");
          }}
        />
      ) : (
        <>

          <section className="record-search-panel" aria-label="Search saved records">
        <div className="record-search-heading">
          <div>
            <p className="search-kicker">OFFLINE RECORDS</p>
            <h2>Find a customer</h2>
          </div>
          <span className="record-count">
            {records.length} {records.length === 1 ? "record" : "records"}
          </span>
        </div>
        <div className="search-field-wrap">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            className="search-field"
            value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setIsSearchOpen(false), 150)}
            placeholder="Search by name, phone, record no., style or colour"
            aria-label="Search saved records"
            autoComplete="off"
          />
          {searchTerm && (
            <button className="clear-search" type="button" onClick={() => setSearchTerm("")}>
              Clear
            </button>
          )}
        </div>
        {isSearchOpen && <div className="record-results" aria-live="polite">
          {visibleRecords.length > 0 ? (
            visibleRecords.map((record) => (
              <button
                className="record-result"
                type="button"
                key={record.id}
                onClick={() => void openRecord(record)}
              >
                <span className="record-avatar">{(record.name || "?").trim().charAt(0).toUpperCase()}</span>
                <span className="record-result-main">
                  <strong>{record.name || "Unnamed customer"}</strong>
                  <span>{record.tel || "No phone number"}</span>
                </span>
                <span className="record-result-meta">
                  <span>{record.record_number || "No. —"}</span>
                  <span>{record.garment_style || record.colour || "Measurement record"}</span>
                </span>
                <span className="record-arrow" aria-hidden="true">→</span>
              </button>
            ))
          ) : (
            <div className="no-records">
              <strong>{records.length === 0 ? "No saved records yet" : "No matching records"}</strong>
              <span>
                {records.length === 0
                  ? "Complete the form and choose Save record to create your first customer record."
                  : "Try a different name, phone number, record number, style or colour."}
              </span>
            </div>
          )}
        </div>}
          </section>

          <div className="form-actions-bar">
            <div className="form-actions-context">
              <span>Current record</span>
              <strong>{recordLabel}</strong>
            </div>
            <div className="form-actions-buttons">
              <button className="secondary-button" type="button" onClick={resetForm}>
                New record
              </button>
              <button className="primary-button" type="button" onClick={() => void saveRecord()} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save record"}
              </button>
            </div>
          </div>

          <section className="paper-wrap" aria-label="VaaLeo Designs measurement form">
        <div className="paper" style={{ backgroundImage: `url("${formDesign}")` }}>
          {input("name", "customer-name", { left: "20.3%", top: "8.35%", width: "30.2%" })}
          {input("colour", "customer-colour", { left: "20.3%", top: "10.7%", width: "30.2%" })}
          {input("garmentStyle", "garment-style", { left: "20.3%", top: "13.0%", width: "30.2%" })}
          {input("tel", "customer-tel", { left: "60.8%", top: "8.35%", width: "31.0%" })}
          {input("recordNumber", "record-number", { left: "60.8%", top: "10.7%", width: "31.0%" })}
          {input("date", "record-date", { left: "60.8%", top: "13.0%", width: "31.0%" })}

          <div className="measurement-inputs" aria-label="Measurements">
            {measurementItems.map(([key, label]) => (
              <input
                key={key}
                value={form.measurements[key]}
                onChange={(event) => updateMeasurement(key, event.target.value)}
                aria-label={label}
              />
            ))}
          </div>

          <ImageZone
            title="Attach clothing photos"
            hint="Design drawing"
            images={form.designImages}
            onChange={(event) => void handleImages(event, "designImages")}
            onRemove={(index) => removeImage("designImages", index)}
            onViewImage={setViewerImage}
            className="design-zone"
          />
          <ImageZone
            title="Attach fabric photos"
            hint="Fabric"
            images={form.fabricImages}
            onChange={(event) => void handleImages(event, "fabricImages")}
            onRemove={(index) => removeImage("fabricImages", index)}
            onViewImage={setViewerImage}
            className="fabric-zone"
          />

          <textarea
            className="paper-input notes-input"
            style={{ left: "3.3%", top: "87.3%", width: "64.0%", height: "8.4%" }}
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            aria-label="notes"
          />
          {input("collectionDate", "collection-date", { left: "70.0%", top: "88.7%", width: "25.2%" }, "DD / MM / YYYY")}
          {input("recordedIn", "recorded-in", { left: "31.5%", top: "96.9%", width: "24.0%" }, "CM / inches")}
          {input("approval", "approval-input", { left: "61.8%", top: "96.9%", width: "28.5%" })}
        </div>
          </section>
        </>
      )}
    </main>
  );
}

type AuthScreenProps = {
  configured: boolean;
  loading: boolean;
  email: string;
  password: string;
  mode: "sign-in" | "sign-up";
  status: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onModeChange: (value: "sign-in" | "sign-up") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function AuthScreen({
  configured,
  loading,
  email,
  password,
  mode,
  status,
  onEmailChange,
  onPasswordChange,
  onModeChange,
  onSubmit,
}: AuthScreenProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="VaaLeo Designs account access">
        <p className="toolbar-kicker">VAALEO DESIGNS</p>
        <h1>Measurement records</h1>
        <p className="auth-intro">
          Sign in to access your customer records and keep them available across your devices.
        </p>

        {loading ? (
          <div className="auth-loading">Checking your account…</div>
        ) : !configured ? (
          <div className="auth-setup-message">
            <strong>Supabase is not configured</strong>
            <span>
              Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to the project’s
              <code>.env</code> file, then rebuild the app.
            </span>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </label>
            <button className="primary-button auth-submit" type="submit">
              {mode === "sign-in" ? "Sign in" : "Create account"}
            </button>
            <button
              className="sync-text-button auth-mode-button"
              type="button"
              onClick={() => onModeChange(mode === "sign-in" ? "sign-up" : "sign-in")}
            >
              {mode === "sign-in" ? "Create a new account" : "I already have an account"}
            </button>
            <p className="auth-status">{status}</p>
          </form>
        )}
      </section>
    </main>
  );
}

type SyncBarProps = {
  configured: boolean;
  session: Session | null;
  email: string;
  password: string;
  mode: "sign-in" | "sign-up";
  status: string;
  isSyncing: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onModeChange: (value: "sign-in" | "sign-up") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSync: () => void;
  onSignOut: () => void;
};

function SyncBar({
  configured,
  session,
  email,
  password,
  mode,
  status,
  isSyncing,
  onEmailChange,
  onPasswordChange,
  onModeChange,
  onSubmit,
  onSync,
  onSignOut,
}: SyncBarProps) {
  if (!configured) {
    return (
      <section className="sync-bar sync-bar-not-configured" aria-label="Online sync setup">
        <div>
          <strong>Online sync is not configured</strong>
          <span>Add the Supabase values from <code>.env.example</code> before building.</span>
        </div>
      </section>
    );
  }

  if (session) {
    return (
      <section className="sync-bar" aria-label="Online sync">
        <div className="sync-status-copy">
          <span className="sync-dot" aria-hidden="true" />
          <div>
            <strong>Online sync enabled</strong>
            <span>{session.user.email} · {status}</span>
          </div>
        </div>
        <div className="sync-actions">
          {status.startsWith("Sync failed") && (
            <button className="secondary-button" type="button" onClick={onSync} disabled={isSyncing}>
              {isSyncing ? "Retrying…" : "Retry sync"}
            </button>
          )}
          <button className="sync-text-button" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
    );
  }

  return (
    <section className="sync-bar sync-auth-bar" aria-label="Sign in for online sync">
      <div className="sync-auth-copy">
        <strong>Sync across devices</strong>
        <span>{status}</span>
      </div>
      <form className="sync-auth-form" onSubmit={onSubmit}>
        <input
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="Email"
          aria-label="Supabase email"
          autoComplete="email"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="Password"
          aria-label="Supabase password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          minLength={6}
          required
        />
        <button className="primary-button" type="submit">
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
        <button
          className="sync-text-button"
          type="button"
          onClick={() => onModeChange(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          {mode === "sign-in" ? "Create account" : "I already have an account"}
        </button>
      </form>
    </section>
  );
}

type RecordsManagerProps = {
  records: RecordSummary[];
  totalRecords: number;
  searchTerm: string;
  onSearch: (value: string) => void;
  onOpen: (record: RecordSummary) => void;
  onNew: () => void;
};

function RecordsManager({
  records,
  totalRecords,
  searchTerm,
  onSearch,
  onOpen,
  onNew,
}: RecordsManagerProps) {
  const withPhone = records.filter((record) => record.tel?.trim()).length;
  const latestRecord = records[0];

  return (
    <section className="manager-screen" aria-label="Manage saved records">
      <div className="manager-heading">
        <div>
          <p className="search-kicker">RECORD MANAGEMENT</p>
          <h2>Customer records</h2>
          <p>Open a saved record to view or update the complete measurement form.</p>
        </div>
        <button className="primary-button" type="button" onClick={onNew}>
          New measurement
        </button>
      </div>

      <div className="manager-stats" aria-label="Record statistics">
        <div className="manager-stat">
          <span>Total records</span>
          <strong>{totalRecords}</strong>
        </div>
        <div className="manager-stat">
          <span>With phone number</span>
          <strong>{withPhone}</strong>
        </div>
        <div className="manager-stat">
          <span>Most recently updated</span>
          <strong>{latestRecord?.name || "—"}</strong>
        </div>
      </div>

      <div className="manager-list-card">
        <div className="manager-list-toolbar">
          <div className="search-field-wrap">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              className="search-field"
              value={searchTerm}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search name, phone, record no., style or colour"
              aria-label="Search customer records"
              autoComplete="off"
            />
            {searchTerm && (
              <button className="clear-search" type="button" onClick={() => onSearch("")}>
                Clear
              </button>
            )}
          </div>
          <span className="manager-result-count">
            {records.length} {records.length === 1 ? "match" : "matches"}
          </span>
        </div>

        {records.length > 0 ? (
          <div className="manager-record-list">
            {records.map((record) => (
              <button className="manager-record" type="button" key={record.id} onClick={() => onOpen(record)}>
                <span className="record-avatar">{(record.name || "?").trim().charAt(0).toUpperCase()}</span>
                <span className="manager-record-customer">
                  <strong>{record.name || "Unnamed customer"}</strong>
                  <span>{record.tel || "No phone number"}</span>
                </span>
                <span className="manager-record-detail">
                  <small>Record number</small>
                  <span>{record.record_number || "—"}</span>
                </span>
                <span className="manager-record-detail">
                  <small>Garment / style</small>
                  <span>{record.garment_style || "—"}</span>
                </span>
                <span className="manager-record-detail">
                  <small>Colour</small>
                  <span>{record.colour || "—"}</span>
                </span>
                <span className="manager-open">Open&nbsp; →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="manager-empty">
            <div className="manager-empty-icon">⌕</div>
            <strong>{totalRecords === 0 ? "Your saved records will appear here" : "No matching records"}</strong>
            <span>
              {totalRecords === 0
                ? "Create and save a measurement form to start building your customer list."
                : "Try a different search term."}
            </span>
            {totalRecords === 0 && (
              <button className="secondary-button" type="button" onClick={onNew}>
                Create first record
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

type RecordDetailProps = {
  record: FormState;
  onBack: () => void;
  onDelete: () => void;
  onViewImage: (image: ImageAttachment) => void;
  onEdit: () => void;
};

function RecordDetail({ record, onBack, onDelete, onViewImage, onEdit }: RecordDetailProps) {
  const displayName = record.name || "Unnamed customer";
  const enteredMeasurements = measurementItems.filter(([key]) =>
    record.measurements[key]?.trim(),
  ).length;

  return (
    <section className="detail-screen" aria-label="Customer record details">
      <div className="detail-heading">
        <div>
          <button className="back-link" type="button" onClick={onBack}>← Back to records</button>
          <p className="search-kicker">CUSTOMER RECORD</p>
          <h2>{displayName}</h2>
          <p>Saved offline in SQLite · Record {record.recordNumber || "without a number"}</p>
        </div>
        <div className="detail-actions">
          <button className="secondary-button" type="button" onClick={onBack}>Back to records</button>
          <button className="primary-button" type="button" onClick={onEdit}>Edit record</button>
          <button className="danger-button" type="button" onClick={onDelete}>Delete record</button>
        </div>
      </div>

      <div className="detail-identity-card">
        <div className="detail-identity-main">
          <span className="detail-avatar">{(record.name || "?").trim().charAt(0).toUpperCase()}</span>
          <div>
            <strong>{displayName}</strong>
            <span>{record.garmentStyle || "Measurement record"}</span>
          </div>
        </div>
        <DetailField label="Phone" value={record.tel} />
        <DetailField label="Colour" value={record.colour} />
        <DetailField label="Date" value={record.date} />
        <DetailField label="Collection date" value={record.collectionDate} />
        <DetailField label="Measurements recorded in" value={record.recordedIn} />
        <DetailField label="Approval" value={record.approval} />
      </div>

      <div className="detail-section-heading">
        <div>
          <p className="search-kicker">MEASUREMENTS</p>
          <h3>Measurement summary</h3>
        </div>
        <span>{enteredMeasurements} of {measurementItems.length} entered</span>
      </div>

      <div className="measurement-summary-grid">
        {measurementGroups.map((group) => (
          <section className="measurement-summary-card" key={group.label}>
            <h4>{group.label}</h4>
            <div className="measurement-summary-list">
              {group.items.filter(([key]) => record.measurements[key]?.trim()).length > 0 ? (
                group.items
                  .filter(([key]) => record.measurements[key]?.trim())
                  .map(([key, label]) => (
                    <div className="measurement-summary-row" key={key}>
                      <span>{label}</span>
                      <strong>{record.measurements[key]}</strong>
                    </div>
                  ))
              ) : (
                <div className="measurement-empty">No measurements entered in this section.</div>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="detail-lower-grid">
        <section className="detail-content-card">
          <div className="detail-section-heading compact">
            <div>
              <p className="search-kicker">NOTES</p>
              <h3>Special instructions</h3>
            </div>
          </div>
          <p className="detail-notes">{record.notes || "No special instructions added."}</p>
        </section>

        <section className="detail-content-card">
          <div className="detail-section-heading compact">
            <div>
              <p className="search-kicker">REFERENCE IMAGES</p>
              <h3>Clothing and fabric</h3>
            </div>
          </div>
          <div className="detail-media-grid">
            <DetailMedia title="Design" images={record.designImages} onViewImage={onViewImage} />
            <DetailMedia title="Fabric" images={record.fabricImages} onViewImage={onViewImage} />
          </div>
        </section>
      </div>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <small>{label}</small>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function DetailMedia({
  title,
  images,
  onViewImage,
}: {
  title: string;
  images: ImageAttachment[];
  onViewImage: (image: ImageAttachment) => void;
}) {
  return (
    <div className="detail-media">
      <div className="detail-media-title">
        <strong>{title}</strong>
        <span>{images.length ? `${images.length} image${images.length === 1 ? "" : "s"}` : "None"}</span>
      </div>
      {images.length ? (
        <div className="detail-media-images">
          {images.map((image, index) => (
            <button
              className="detail-media-image-button"
              key={`${image.name}-${index}`}
              type="button"
              onClick={() => onViewImage(image)}
              title={`View ${image.name}`}
            >
              <img src={image.dataUrl} alt={image.name} />
            </button>
          ))}
        </div>
      ) : (
        <div className="detail-media-empty">No reference image attached</div>
      )}
    </div>
  );
}

type ImageZoneProps = {
  title: string;
  hint: string;
  images: ImageAttachment[];
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  onViewImage: (image: ImageAttachment) => void;
  className: string;
};

function ImageZone({ title, hint, images, onChange, onRemove, onViewImage, className }: ImageZoneProps) {
  return (
    <div className={`image-zone ${className}`}>
      <div className="image-zone-content">
        <span className="image-zone-hint">{hint}</span>
        {images.length === 0 && <span className="image-zone-prompt">Add clothing photo</span>}
        <label className="image-add-button">
          <span>{images.length ? "Add more" : "Choose image"}</span>
          <input type="file" accept="image/*" multiple onChange={onChange} aria-label={title} />
        </label>
      </div>
      {images.length > 0 && (
        <div className="image-previews">
          {images.map((image, index) => (
            <div className="image-preview" key={`${image.name}-${index}`}>
              <button
                className="image-preview-open"
                type="button"
                onClick={() => onViewImage(image)}
                title={`View ${image.name}`}
              >
                <img src={image.dataUrl} alt={image.name} />
              </button>
              <button
                className="image-remove-button"
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${image.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageViewer({
  image,
  onClose,
}: {
  image: ImageAttachment | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!image) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div className="image-viewer-backdrop" role="dialog" aria-modal="true" aria-label={`Viewing ${image.name}`} onClick={onClose}>
      <div className="image-viewer-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="image-viewer-close" type="button" onClick={onClose} aria-label="Close image viewer">
          ×
        </button>
        <img src={image.dataUrl} alt={image.name} />
        <span>{image.name}</span>
      </div>
    </div>
  );
}

export default App;
