# ox

Exécutez des agents de codage IA dans des bacs à sable isolés, une tâche à la fois.

Ox automatise l'intégralité du flux de travail de démarrage d'une tâche de codage : il crée une branche de fonctionnalité, forke optionnellement votre base de données et lance un agent IA dans un bac à sable isolé - le tout à partir d'une seule commande ou d'une interface utilisateur de terminal interactive.

### Fonctionnalités

- **Exécution en bac à sable** -- Les agents s'exécutent dans des conteneurs Docker isolés ou des bacs à sable cloud, jamais sur votre machine hôte
- **Branche par tâche** -- Crée automatiquement une branche git avec un nom généré par LLM pour chaque tâche
- **Forking de base de données** -- Forke optionnellement votre base de données Timescale par branche pour une isolation complète de l'environnement
- **Agents multiples** -- Supporte Claude Code et OpenCode prêts à l'emploi
- **Interface utilisateur interactive** -- Interface utilisateur de terminal riche pour gérer les sessions, avec une palette de commandes, 30+ thèmes et raccourcis clavier
- **Gestion des sessions** -- Démarrez, arrêtez, reprenez, attachez-vous et ouvrez un shell dans les sessions d'agent à tout moment
- **Deux fournisseurs de bac à sable** -- Exécutez localement avec Docker ou à distance avec des bacs à sable cloud
- **Mise à jour automatique** -- Se met à jour lui-même en arrière-plan

## Démarrage rapide

```bash
# Installer
curl -fsSL https://get.ox.build | bash

# Exécuter l'interface utilisateur interactive
ox

# Ou démarrer une tâche directement
ox "Add input validation to the signup form"
```

## Installation

### Installation rapide (Recommandée)

```bash
curl -fsSL https://get.ox.build | bash
```

Après l'installation, redémarrez votre shell ou exécutez `source ~/.zshrc` (ou `source ~/.bashrc`) pour mettre à jour votre PATH.

Réexécutez la commande à tout moment pour mettre à jour vers la dernière version.

### Homebrew

```bash
brew install timescale/tap/ox
```

### npm

```bash
npm i -g @ox.build/cli
```

### Source (Développeurs)

```bash
git clone https://github.com/timescale/ox.git
cd ox
./bun i && ./bun link
source ~/.zshrc  # ou redémarrez votre shell
```

### Terminal recommandé

Bien que n'importe quel terminal devrait fonctionner, nous recommandons [Ghostty](https://ghostty.org/) pour la meilleure expérience TUI :

```bash
brew install --cask ghostty
```

## Utilisation

### Interface utilisateur interactive

Exécutez `ox` sans arguments pour ouvrir l'interface utilisateur de terminal complète. De là, vous pouvez écrire une invite pour démarrer une nouvelle tâche, parcourir les sessions actives, reprendre le travail précédent et gérer la configuration.

```bash
ox
```

### Tâche unique

Passez une description en langage naturel pour démarrer une tâche directement :

```bash
ox "Refactor the auth middleware to use JWT tokens"
```

Ox créera une branche, configurera un bac à sable et lancera l'agent configuré avec votre invite. L'agent s'exécute en arrière-plan -- utilisez `ox sessions` pour le vérifier, ou `ox` pour ouvrir l'interface utilisateur et vous attacher.

### Mode interactif

Pour travailler aux côtés de l'agent dans une session de terminal en direct :

```bash
ox -i "Fix the failing integration tests"
```

### Accès au shell

Ouvrez un shell bash dans un nouveau bac à sable sans démarrer un agent :

```bash
ox shell
```

Ou ouvrez un shell dans une session en cours d'exécution :

```bash
ox resume --shell <session>
```

## Fournisseurs de bac à sable

Ox prend en charge deux fournisseurs de bac à sable pour exécuter les agents :

### Docker (Par défaut)

Les agents s'exécutent dans des conteneurs Docker locaux construits à partir d'images spécialement conçues qui incluent des outils de développement courants, des runtimes de langage et les CLI de l'agent IA. Votre code est soit cloné depuis GitHub, soit lié à partir de votre système de fichiers local.

```bash
# Monter votre répertoire de travail local dans le bac à sable
ox --mount "Add tests for the new API endpoints"
```

### Cloud

Les agents s'exécutent dans des bacs à sable cloud distants alimentés par Deno Deploy. Ceci est utile pour décharger le travail de votre machine ou exécuter des tâches en parallèle sans contraintes de ressources locales.

```bash
# Utiliser le fournisseur cloud
ox --provider cloud "Migrate the database schema"
```

Configurez le fournisseur par défaut dans votre config :

```yaml
# .ox/config.yml
sandboxProvider: cloud
cloudRegion: ord  # ord (Chicago) ou ams (Amsterdam)
```

## Support des agents

Ox est livré avec le support de deux agents de codage IA :

| Agent | Description |
|-------|-------------|
| **OpenCode** | CLI d'agent de codage open-source avec support pour plusieurs fournisseurs de modèles |
| **Claude Code** | CLI Claude Code d'Anthropic |

Sélectionnez un agent par tâche ou définissez une valeur par défaut :

```bash
# Utiliser un agent spécifique pour cette tâche
ox --agent claude "Implement the new dashboard component"

# Définir une valeur par défaut dans la config
ox config
```

Vous pouvez également choisir un modèle spécifique :

```bash
ox --model opus "Design the database schema for the new feature"
```

## Forking de base de données

Lorsque vous travaillez avec une base de données [Timescale](https://www.timescale.com/), Ox peut créer automatiquement un fork de base de données isolé pour chaque branche de tâche. Cela donne à chaque session d'agent sa propre copie de la base de données avec laquelle travailler, de sorte que les modifications de schéma et les données de test ne se heurtent jamais entre les tâches.

Le forking de base de données est optionnel. Si aucun service Timescale n'est configuré, Ox ignore cette étape et crée le bac à sable sans fork de base de données.

```yaml
# .ox/config.yml
tigerServiceId: your-service-id  # ou null pour désactiver
```

## Configuration

Ox utilise un système de configuration YAML à deux niveaux :

| Niveau | Emplacement | Objectif |
|--------|-------------|----------|
| **Utilisateur** | `~/.config/ox/config.yml` | Valeurs par défaut personnelles pour tous les projets |
| **Projet** | `.ox/config.yml` | Remplacements spécifiques au projet (gitignored) |

La configuration du projet prend précédence sur la configuration de l'utilisateur.

### Configuration interactive

Exécutez `ox config` pour parcourir un assistant de configuration interactive qui configure votre fournisseur de bac à sable, agent, modèle et authentification.

### Options clés

```yaml
# .ox/config.yml
agent: opencode             # Agent par défaut : opencode ou claude
model: sonnet               # Modèle par défaut pour l'agent sélectionné
sandboxProvider: docker      # Fournisseur de bac à sable : docker ou cloud
cloudRegion: ord             # Région cloud : ord (Chicago) ou ams (Amsterdam)
tigerServiceId: null         # ID de service Timescale pour DB forking (null pour désactiver)
overlayMounts:               # Chemins à isoler en mode montage (par ex., node_modules)
  - node_modules
initScript: 'npm install'   # Commande shell à exécuter avant de démarrer l'agent
themeName: opencode          # Thème TUI (30+ thèmes intégrés)
```

### Variables d'environnement

Placez un fichier `.ox/.env` dans la racine de votre projet pour transmettre des variables d'environnement dans le bac à sable :

```env
DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=your-key-here
```

## Gestion des sessions

### Énumération des sessions

```bash
# Ouvrir la liste des sessions TUI
ox sessions

# Sortie du tableau
ox sessions --output table

# Sortie JSON pour les scripts
ox sessions --output json

# Inclure les sessions arrêtées
ox sessions --all
```

### Reprise des sessions

```bash
# Reprendre une session arrêtée
ox resume <session>

# Reprendre avec une nouvelle invite
ox resume <session> "Continue by adding error handling"

# Reprendre en arrière-plan
ox resume --detach <session>
```

### Nettoyage

```bash
# Supprimer les conteneurs arrêtés
ox sessions clean

# Supprimer tous les conteneurs (y compris en cours d'exécution)
ox sessions clean --all

# Nettoyer les anciennes images, volumes et snapshots
ox resources clean
```

## Référence CLI

| Commande | Description |
|----------|-------------|
| `ox [prompt]` | Démarrer une nouvelle tâche ou ouvrir l'interface utilisateur |
| `ox sessions` | Énumérer et gérer les sessions |
| `ox resume <session>` | Reprendre une session arrêtée |
| `ox shell` | Ouvrir un shell dans un nouveau bac à sable |
| `ox config` | Assistant de configuration interactive |
| `ox auth check <provider>` | Vérifier l'état de l'authentification |
| `ox auth login <provider>` | Se connecter à un fournisseur |
| `ox resources` | Gérer les images de bac à sable, les volumes et les snapshots |
| `ox logs` | Afficher les journaux ox |
| `ox upgrade` | Vérifier et installer les mises à jour |
| `ox completions [shell]` | Configurer les complétions d'onglet shell |
| `ox claude [args...]` | Exécuter Claude Code dans un bac à sable |
| `ox opencode [args...]` | Exécuter OpenCode dans un bac à sable |
| `ox gh [args...]` | Exécuter la CLI GitHub dans un bac à sable |
| `ox colors` | Afficher les échantillons de couleur du thème |

Utilisez `ox <command> --help` pour des options détaillées sur n'importe quelle commande.

## Licence

Apache 2.0 -- voir [LICENSE](LICENSE) pour les détails.
