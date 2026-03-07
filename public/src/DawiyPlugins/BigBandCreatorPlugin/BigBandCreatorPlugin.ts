import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";
import HostAPI from "../API/HostAPI";

@DAWIYPlugin
export default class BigBandCreatorPlugin extends DawiyPluginBase {
    id = "big-band-creator";
    name = "Big Band Track Creator (No Alto Sax)";
    description = "アルトサックスを除いたビッグバンド編成の空トラックを一括で作成します。";
    author = "AI Assistant";
    version = "1.0.1"; // バージョンを更新しました
    group = "generator";

    constructor(app: App) {
        super(app);
    }

    public override onInit(host: HostAPI) {
        super.onInit(host);
    }

    public override render(container: HTMLElement) {
        container.innerHTML = '';
        container.style.padding = "20px";
        container.style.color = "#ecf0f1";
        container.style.fontFamily = "Arial, sans-serif";

        const title = document.createElement("h3");
        title.textContent = this.name;
        title.style.marginBottom = "15px";
        container.appendChild(title);

        const description = document.createElement("p");
        description.textContent = this.description;
        description.style.marginBottom = "20px";
        container.appendChild(description);

        const createButton = document.createElement("button");
        createButton.textContent = "ビッグバンドトラックを作成";
        createButton.className = "btn btn-primary";
        createButton.style.padding = "10px 20px";
        createButton.style.fontSize = "16px";
        createButton.style.cursor = "pointer";
        createButton.onclick = () => this.createBigBandTracks();
        container.appendChild(createButton);

        const trackListContainer = document.createElement("div");
        trackListContainer.style.marginTop = "30px";
        trackListContainer.innerHTML = '<h4>作成されるトラック一覧:</h4>';
        
        const ul = document.createElement("ul");
        ul.style.listStyleType = "disc";
        ul.style.marginLeft = "20px";
        ul.style.color = "#bdc3c7";
        this.getBigBandTrackNames().forEach(trackName => {
            const li = document.createElement("li");
            li.textContent = trackName;
            ul.appendChild(li);
        });
        trackListContainer.appendChild(ul);
        container.appendChild(trackListContainer);
    }

    /**
     * アルトサックスを除いたビッグバンド編成のトラック名リストを返します。
     */
    private getBigBandTrackNames(): string[] {
        return [
            "Tenor Sax 1", "Tenor Sax 2", "Baritone Sax", // アルトサックスを除外しました
            "Trumpet 1", "Trumpet 2", "Trumpet 3", "Trumpet 4",
            "Trombone 1", "Trombone 2", "Trombone 3", "Bass Trombone",
            "Piano", "Bass", "Drums", "Guitar"
        ];
    }

    private async createBigBandTracks() {
        this.app.hostAPI.ui.showToast("ビッグバンドトラックの作成を開始します...");
        const trackNames = this.getBigBandTrackNames();
        let createdCount = 0;

        for (const name of trackNames) {
            try {
                await this.app.hostAPI.project.createTrack(name);
                createdCount++;
            } catch (error) {
                this.app.hostAPI.ui.showToast(`トラック「${name}」の作成に失敗しました。`, true);
                console.error(`Failed to create track ${name}:`, error);
            }
        }

        if (createdCount === trackNames.length) {
            this.app.hostAPI.ui.showToast("ビッグバンド編成の全トラックを作成しました！");
        } else {
            this.app.hostAPI.ui.showToast(`一部のトラックの作成に失敗しましたが、${createdCount}個のトラックを作成しました。`, true);
        }
    }

    public override onActivate() {
        console.log("BigBandCreatorPlugin activated");
    }

    public override onDeactivate() {
        console.log("BigBandCreatorPlugin deactivated");
    }
}