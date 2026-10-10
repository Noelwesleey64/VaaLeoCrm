use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_measurement_records",
        sql: "CREATE TABLE IF NOT EXISTS measurement_records (
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
            approval TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:vaaleo.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
