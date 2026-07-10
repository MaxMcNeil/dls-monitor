import requests
import json
import re
from bs4 import BeautifulSoup
from datetime import datetime

# URLs sources du dépôt dls-monitor
POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json"
SOURCE_BASE_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/source/"

def sanitize_text(text):
    # Remplacement des mots sensibles pour l'algorithme
    text = re.sub(r'leak|leaked|stolen', 'Shared Context', text, flags=re.IGNORECASE)
    text = re.sub(r'attack|hacked|piraté', 'Incident', text, flags=re.IGNORECASE)
    # Censure automatique des emails et téléphones pour la politique YT
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_PROTECTED]', text)
    text = re.sub(r'\+?\d{10,13}', '[PHONE_PROTECTED]', text)
    return text.strip()

def get_cyber_feed():
    try:
        posts = requests.get(POSTS_URL).json()
    except Exception as e:
        print("Erreur de récupération du flux brut"); return

    output_feed = []
    
    # On traite les 10 alertes les plus récentes
    for post in posts[:10]:
        title = post.get("post_title", "Cible Inconnue")
        group = post.get("group_name", "Cyber-Acteur")
        date_raw = post.get("discovered", "")
        
        # Formatage du nom du fichier HTML d'origine dans source/ (slugification classique)
        # Ex: "Karl Chevrolet" -> "karl-chevrolet.html" ou structure similaire du repo
        safe_name = re.sub(r'[^a-zA-Z0-9-]', '', title.lower().replace(" ", "-"))
        html_url = f"{SOURCE_BASE_URL}{group}/{safe_name}.html" # Structure estimée selon l'acteur
        
        details = "Analyse en cours : En attente de détails textuels complémentaires..."
        
        # Tentative de récupération des détails dans l'HTML brut
        try:
            html_res = requests.get(html_url)
            if html_res.status_code == 200:
                soup = BeautifulSoup(html_res.text, 'html.parser')
                raw_text = soup.get_text(separator=' ')
                # On extrait les 300 premiers caractères pertinents nettoyés
                details = sanitize_text(raw_text)[:300] + "..."
        except:
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

