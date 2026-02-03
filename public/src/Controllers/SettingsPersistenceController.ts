import { BACKEND_URL } from "../Env";

export default class SettingsPersistenceController {
    static settings: any = {};

    static async init() {
        try {
            const res = await fetch(`${BACKEND_URL}/settings`);
            if (res.ok) {
                this.settings = await res.json();
                console.log("Settings loaded:", this.settings);
            } else {
                console.warn("Settings API returned " + res.status);
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }

    static async save(key: string, value: any) {
        this.settings[key] = value;
        try {
            await fetch(`${BACKEND_URL}/settings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [key]: value })
            });
        } catch (e) {
            console.error("Failed to save settings", e);
        }
    }

    static get<T>(key: string, defaultValue?: T): T {
        return (this.settings[key] !== undefined ? this.settings[key] : defaultValue) as T;
    }
}
