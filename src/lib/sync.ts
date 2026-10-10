import Database from "@tauri-apps/plugin-sql";
import { supabase } from "./supabase";

type ImageAttachment = {
  name: string;
  dataUrl: string;
};

export type LocalSyncRecord = {
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

type RemoteSyncRecord = {
  id: string;
  user_id: string;
  name: string;
  colour: string | null;
  garment_style: string | null;
  tel: string | null;
  record_number: string | null;
  date: string | null;
  measurements: Record<string, string>;
  design_images: ImageAttachment[];
  fabric_images: ImageAttachment[];
  notes: string | null;
  collection_date: string | null;
  recorded_in: string | null;
  approval: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toRemoteRecord = (record: LocalSyncRecord, userId: string): RemoteSyncRecord => ({
  id: record.id,
  user_id: userId,
  name: record.name,
  colour: record.colour,
  garment_style: record.garment_style,
  tel: record.tel,
  record_number: record.record_number,
  date: record.date,
  measurements: parseJson<Record<string, string>>(record.measurements_json, {}),
  design_images: parseJson<ImageAttachment[]>(record.design_images_json, []),
  fabric_images: parseJson<ImageAttachment[]>(record.fabric_images_json, []),
  notes: record.notes,
  collection_date: record.collection_date,
  recorded_in: record.recorded_in,
  approval: record.approval,
  created_at: record.created_at,
  updated_at: record.updated_at,
  deleted_at: record.deleted_at,
});

const upsertLocalRecord = async (db: Database, record: RemoteSyncRecord) => {
  await db.execute(
    `INSERT INTO measurement_records
      (id, name, colour, garment_style, tel, record_number, date, measurements_json,
       design_images_json, fabric_images_json, notes, collection_date, recorded_in, approval,
       created_at, updated_at, sync_status, last_synced_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'synced', $17, $18)
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
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       sync_status = 'synced',
       last_synced_at = excluded.last_synced_at,
       deleted_at = excluded.deleted_at`,
    [
      record.id,
      record.name,
      record.colour,
      record.garment_style,
      record.tel,
      record.record_number,
      record.date,
      JSON.stringify(record.measurements),
      JSON.stringify(record.design_images),
      JSON.stringify(record.fabric_images),
      record.notes,
      record.collection_date,
      record.recorded_in,
      record.approval,
      record.created_at,
      record.updated_at,
      new Date().toISOString(),
      record.deleted_at,
    ],
  );
};

export const upsertRecordOnline = async (record: LocalSyncRecord, userId: string) => {
  if (!supabase) throw new Error("Supabase is not configured");

  const { error } = await supabase
    .from("measurement_records")
    .upsert([toRemoteRecord(record, userId)], { onConflict: "id" });
  if (error) throw error;
};

export const deleteRecordOnline = async (recordId: string, userId: string, deletedAt: string) => {
  if (!supabase) throw new Error("Supabase is not configured");

  const { error } = await supabase
    .from("measurement_records")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", recordId)
    .eq("user_id", userId);
  if (error) throw error;
};

export const allocateCustomerNumberOnline = async () => {
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase.rpc("allocate_customer_number");
  if (error) throw error;
  if (typeof data !== "number" && typeof data !== "string") {
    throw new Error("Supabase returned an invalid customer number");
  }
  return String(data);
};

export const syncRecords = async (db: Database, userId: string) => {
  if (!supabase) throw new Error("Supabase is not configured");

  const pending = await db.select<LocalSyncRecord[]>(
    "SELECT * FROM measurement_records WHERE sync_status = 'pending' ORDER BY updated_at ASC",
  );

  if (pending.length) {
    const { error } = await supabase
      .from("measurement_records")
      .upsert(pending.map((record) => toRemoteRecord(record, userId)), { onConflict: "id" });
    if (error) throw error;

    const syncedAt = new Date().toISOString();
    for (const record of pending) {
      await db.execute(
        "UPDATE measurement_records SET sync_status = 'synced', last_synced_at = $1 WHERE id = $2",
        [syncedAt, record.id],
      );
    }
  }

  const { data, error } = await supabase
    .from("measurement_records")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: true });
  if (error) throw error;

  const remoteRecords = (data ?? []) as RemoteSyncRecord[];
  for (const remoteRecord of remoteRecords) {
    const localRows = await db.select<LocalSyncRecord[]>(
      "SELECT * FROM measurement_records WHERE id = $1 LIMIT 1",
      [remoteRecord.id],
    );
    const localRecord = localRows[0];
    if (!localRecord || remoteRecord.updated_at >= localRecord.updated_at) {
      await upsertLocalRecord(db, remoteRecord);
    }
  }

  return {
    uploaded: pending.length,
    downloaded: remoteRecords.length,
  };
};
