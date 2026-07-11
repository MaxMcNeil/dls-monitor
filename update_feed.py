import requests
import json
import re
import sys
from bs4 import BeautifulSoup

# SOURCE 1 (Cyberiskvision)
POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json"
API_SOURCE_URL = "https://api.github.com/repos/cyberiskvision/dls-monitor/contents/source"
RAW_SOURCE_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/source/"

# SOURCE 2 (Ransomware.live API - Ultra réactive)
RANSOM_LIVE_API = "https://api.ransomware.live/recent"

def sanitize_text(text):
    if not text: return ""
    text = re.sub(r'leak|leaked|stolen', 'Shared Context', text, flags=re.IGNORECASE)
    text = re.sub(r'attack|hacked|piraté', 'Incident', text, flags=re.IGNORECASE)
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_PROTECTED]', text)
    text = re.sub(r'\+?\d{10,13}', '[PHONE_PROTECTED]', text)
    return text.strip()

def get_cyber_feed():
    print("--- DEBUT DE L'EXTRACTION MULTI-SOURCES ---")
    output_feed = []

    # ==========================================
    # EN CLENCHEMENT DE LA SOURCE 1 : CYBERISK
    # ==========================================
    print(f"Connexion Source 1 : {POSTS_URL}")
    try:
        response = requests.get(POSTS_URL, timeout=12)
        if response.status_code == 200:
            posts = response.json()
            posts.sort(key=lambda x: x.get("discovered", ""), reverse=True)
            
            for post in posts[:10]:
                title = post.get("post_title", "Cible Inconnue")
                group = post.get("group_name", "unknown")
                date_raw = post.get("discovered", "")
                details = "Analyse en cours..."
                
                try:
                    dir_res = requests.get(f"{API_SOURCE_URL}/{group}", timeout=8)
                    if dir_res.status_code == 200:
                        files = dir_res.json()
                        if files:
                            matched_file = files[-1]['name']
                            html_content = requests.get(f"{RAW_SOURCE_URL}{group}/{matched_file}", timeout=8).text
                            soup = BeautifulSoup(html_content, 'html.parser')
                            for script in soup(["script", "style"]): script.decompose()
                            details = sanitize_text(soup.get_text(separator=' '))[:350] + "..."
                except Exception:
                    pass

                output_feed.append({
                    "target": sanitize_text(title),
                    "hacker": group.upper(),
                    "time": date_raw,
                    "details": details
                })
            print(f"OK: {len(output_feed)} éléments chargés depuis Source 1.")
    except Exception as e:
        print(f"Note: Échec Source 1 (Cyberisk) -> {e}")

    # ==========================================
    # EN CLENCHEMENT DE LA SOURCE 2 : RANSOMWARE.LIVE
    # ==========================================
    print(f"Connexion Source 2 : {RANSOM_LIVE_API}")
    try:
        res2 = requests.get(RANSOM_LIVE_API, timeout=12)
        if res2.status_code == 200:
            attacks = res2.json()
            # Si c'est un dictionnaire qui contient une clé 'attacks'
            if isinstance(attacks, dict):
                attacks = attacks.get("attacks", [])
                
            attacks.sort(key=lambda x: x.get("discovered", ""), reverse=True)
            
            count_source2 = 0
            for attack in attacks[:15]: # Analyse les 15 plus récentes de l'API globale
                # On ne prend que le FR ou les mentions France pour filtrer intelligemment
                country = attack.get("country", "")
                company = attack.get("company", "")
                
                # Double vérification FR contextuelle
                if country == "FR" or "FRANCE" in company.upper():
                    output_feed.append({
                        "target": sanitize_text(company),
                        "hacker": attack.get("group_name", "UNKNOWN").upper(),
                        "time": attack.get("discovered", ""),
                        "details": f"Alerte de rançongiciel détectée sur le détecteur secondaire. Groupe : {attack.get('group_name', 'Inconnu')}."
                    })
                    count_source2 += 1
            print(f"OK: {count_source2} cibles stratégiques FR injectées depuis Source 2.")
    except Exception as e:
        print(f"Note: Échec Source 2 (Ransomware.live) -> {e}")

    # ==========================================
    # NETTOYAGE ET TRI DE L'ENSEMBLE
    # ==========================================
    if not output_feed:
        print("ERREUR CRITIQUE: Aucune des sources n'a renvoyé de données.")
        sys.exit(1)

    # Tri final chronologique global pour mélanger proprement les deux sources
    output_feed.sort(key=lambda x: x.get("time", ""), reverse=True)

    # Déduplication par cible (évite les doublons si les deux sources parlent de la même entreprise)
    seen = set()
    final_clean_feed = []
    for item in output_feed:
        if item["target"] not in seen:
            seen.add(item["target"])
            final_clean_feed.append(item)

    # Garde le top 15 final pour ton défilement
    final_clean_feed = final_clean_feed[:15]

    print(f"Écriture finale dans live-feed.json ({len(final_clean_feed)} éléments uniques)...")
    with open("live-feed.json", "w", encoding="utf-8") as f:
        json.dump(final_clean_feed, f, ensure_ascii=False, indent=4)
        
    print("--- PIPELINE MULTI-SOURCE TERMINÉ AVEC SUCCÈS ---")

if __name__ == "__main__":
    get_cyber_feed()
        
