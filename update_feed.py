import requests
import json
import re
import sys

# SOURCE 1 (Cyberiskvision - URLs propres sans API)
POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json"
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
            # Tri par date décroissante
            posts.sort(key=lambda x: x.get("discovered", ""), reverse=True)
            
            print(f"Extraction des détails pour les {min(len(posts), 12)} derniers posts...")
            for post in posts[:12]:
                title = post.get("post_title", "Cible Inconnue")
                group = post.get("group_name", "unknown")
                date_raw = post.get("discovered", "")
                
                # Astuce de secours pour générer une description propre sans appeler l'API GitHub !
                details = f"Alerte majeure : L'organisation {title} est ciblée par le groupe cyber {group.upper()}. Analyse de la fuite en cours."

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
            if isinstance(attacks, dict):
                attacks = attacks.get("attacks", [])
                
            attacks.sort(key=lambda x: x.get("discovered", ""), reverse=True)
            
            count_source2 = 0
            # On élargit l'analyse aux 40 dernières attaques mondiales pour être sûr de capter le FR
            for attack in attacks[:40]: 
                country = attack.get("country", "")
                company = attack.get("company", "")
                group_name = attack.get("group_name", "UNKNOWN")
                
                # Si le pays est FR, ou que la France est détectée dans le nom de la boîte
                if country == "FR" or "FRANCE" in company.upper():
                    output_feed.append({
                        "target": sanitize_text(company),
                        "hacker": group_name.upper(),
                        "time": attack.get("discovered", ""),
                        "details": f"Incident ransomware détecté sur les infrastructures de {company}. Revendiqué par {group_name.upper()}."
                    })
                    count_source2 += 1
            print(f"OK: {count_source2} cibles stratégiques FR injectées depuis Source 2.")
    except Exception as e:
        print(f"Note: Échec Source 2 (Ransomware.live) -> {e}")

    # ==========================================
    # NETTOYAGE, SÉCURISATION ET FILTRAGE
    # ==========================================
    if not output_feed:
        print("ERREUR CRITIQUE: Aucune donnée récupérée des deux sources.")
        sys.exit(1)

    # Tri chronologique global
    output_feed.sort(key=lambda x: x.get("time", ""), reverse=True)

    # Déduplication stricte par nom d'entreprise
    seen = set()
    final_clean_feed = []
    for item in output_feed:
        # Nettoyage de la clé pour éviter les doublons à cause d'une majuscule
        lookup_key = item["target"].lower().strip()
        if lookup_key not in seen:
            seen.add(lookup_key)
            final_clean_feed.append(item)

    # On extrait le top 15 final
    final_clean_feed = final_clean_feed[:15]

    print(f"Écriture finale dans live-feed.json ({len(final_clean_feed)} éléments uniques)...")
    with open("live-feed.json", "w", encoding="utf-8") as f:
        json.dump(final_clean_feed, f, ensure_ascii=False, indent=4)
        
    print("--- PIPELINE MULTI-SOURCE IMMUNISÉ TERMINÉ ---")

if __name__ == "__main__":
    get_cyber_feed()
                
