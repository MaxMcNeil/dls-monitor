import requests
import json
import re
from bs4 import BeautifulSoup
from datetime import datetime

POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json"
# URL de l'API GitHub pour lister les fichiers réels du dossier source
API_SOURCE_URL = "https://api.github.com/repos/cyberiskvision/dls-monitor/contents/source"
RAW_SOURCE_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/source/"

def sanitize_text(text):
    text = re.sub(r'leak|leaked|stolen', 'Shared Context', text, flags=re.IGNORECASE)
    text = re.sub(r'attack|hacked|piraté', 'Incident', text, flags=re.IGNORECASE)
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_PROTECTED]', text)
    text = re.sub(r'\+?\d{10,13}', '[PHONE_PROTECTED]', text)
    return text.strip()

def get_cyber_feed():
    try:
        posts = requests.get(POSTS_URL).json()
    except Exception as e:
        print("Erreur de récupération du flux brut")
        return

    # CORRECTION 1 : Trier les posts pour avoir les dates de 2026 en premier
    # On trie du plus récent au plus ancien basé sur le champ 'discovered'
    posts.sort(key=lambda x: x.get("discovered", ""), reverse=True)

    output_feed = []
    
    # On prend les 10 alertes les plus fraîches de 2026
    for post in posts[:10]:
        title = post.get("post_title", "Cible Inconnue")
        group = post.get("group_name", "unknown")
        date_raw = post.get("discovered", "")
        
        details = "Analyse de la war room en cours... En attente de texte brut descriptif."
        
        # CORRECTION 2 : Recherche dynamique du fichier HTML correspondant dans le dépôt
        # Le dépôt range les fichiers sous la forme : source/{group_name}/{titre_ou_id}.html
        try:
            # On liste le contenu du sous-dossier du groupe via l'API GitHub
            dir_res = requests.get(f"{API_SOURCE_URL}/{group}")
            if dir_res.status_code == 200:
                files = dir_res.json()
                
                # On cherche un fichier dont le nom ressemble à notre cible (target)
                matched_file = None
                clean_target = re.sub(r'[^a-z0-9]', '', title.lower())
                
                for f in files:
                    clean_file_name = re.sub(r'[^a-z0-9]', '', f['name'].lower())
                    if clean_target in clean_file_name or clean_file_name in clean_target:
                        matched_file = f['name']
                        break
                
                # Si aucun match parfait, on prend par défaut le dernier fichier généré dans ce dossier de hacker
                if not matched_file and files:
                    matched_file = files[-1]['name']
                
                if matched_file:
                    # Téléchargement du vrai contenu HTML brut stocké par le robot
                    raw_html_url = f"{RAW_SOURCE_URL}{group}/{matched_file}"
                    html_content = requests.get(raw_html_url).text
                    
                    # Extraction et nettoyage propre du texte
                    soup = BeautifulSoup(html_content, 'html.parser')
                    
                    # On nettoie le code en enlevant les balises scripts/styles inutiles
                    for script in soup(["script", "style"]):
                        script.decompose()
                        
                    raw_text = soup.get_text(separator=' ')
                    # Nettoyage des espaces multiples et application de la censure de sécurité (Politique YT)
                    cleaned_text = ' '.join(raw_text.split())
                    details = sanitize_text(cleaned_text)[:350] + "..."
        except Exception as e:
            # En cas d'erreur de parsing, on garde le texte par défaut propre
            pass

        output_feed.append({
            "target": sanitize_text(title),
            "hacker": group.upper(),
            "time": date_raw,
            "details": details
        })
        
    with open("live-feed.json", "w", encoding="utf-8") as f:
        json.dump(output_feed, f, ensure_ascii=False, indent=4)

if __name__ == "__main__":
    get_cyber_feed()
    
