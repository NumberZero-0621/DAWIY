import DraggableWindow from "../Utils/DraggableWindow";
import { CURRENT_LANGUAGE } from "../Utils/i18n";

/**
 * View for the about window. It contains all the elements of the about window.
 */
export default class AboutWindow extends DraggableWindow {

    constructor() {
        super(document.getElementById("about-header") as HTMLDivElement, document.getElementById("about-window") as HTMLDivElement);
        this.initTabs();
        this.updateLanguage();
    }

    initTabs() {
        const wamTab = document.getElementById("about-tab-wam");
        const dawiyTab = document.getElementById("about-tab-dawiy");
        const wamContent = document.getElementById("about-content-wam");
        const dawiyContent = document.getElementById("about-content-dawiy");

        if (wamTab && dawiyTab && wamContent && dawiyContent) {
            wamTab.onclick = () => {
                wamContent.style.display = "flex";
                dawiyContent.style.display = "none";
                wamTab.style.textDecoration = "underline";
                wamTab.style.fontWeight = "bold";
                wamTab.style.opacity = "1";
                dawiyTab.style.textDecoration = "none";
                dawiyTab.style.fontWeight = "normal";
                dawiyTab.style.opacity = "0.6";
            };

            dawiyTab.onclick = () => {
                wamContent.style.display = "none";
                dawiyContent.style.display = "flex";
                wamTab.style.textDecoration = "none";
                wamTab.style.fontWeight = "normal";
                wamTab.style.opacity = "0.6";
                dawiyTab.style.textDecoration = "underline";
                dawiyTab.style.fontWeight = "bold";
                dawiyTab.style.opacity = "1";
            };
        }
    }

    public updateLanguage() {
        const langEms = document.querySelectorAll(".lang-en");
        const langJas = document.querySelectorAll(".lang-ja");

        // Determine display style based on parent or class nature
        // WAM content (.lang-en/ja inside #about-content-wam) uses flex
        // DAWIY content (.lang-en/ja inside #about-content-dawiy) uses block (default)

        const setDisplay = (elements: NodeListOf<Element>, show: boolean) => {
            elements.forEach(el => {
                const htmlEl = el as HTMLElement;
                if (!show) {
                    htmlEl.style.display = "none";
                } else {
                    // Check if it's inside WAM content which uses flex
                    if (htmlEl.parentElement && htmlEl.parentElement.id === "about-content-wam") {
                        htmlEl.style.display = "flex";
                    } else {
                        htmlEl.style.display = "block";
                    }
                }
            });
        };

        if (CURRENT_LANGUAGE === "ja") {
            setDisplay(langEms, false);
            setDisplay(langJas, true);
        } else {
            setDisplay(langEms, true);
            setDisplay(langJas, false);
        }
    }

}