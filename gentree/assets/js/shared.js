// Shared utilities for the family tree site

// Base URL for loading data from the original website
const BASE_URL = 'https://karmifamily.com/';

// Per-profile base URL: tracks whether profile was loaded locally or from BASE_URL
const profileBaseUrls = new Map();

// Resolve a resource URL using the profile's resolved base
function resolveUrl(url, profileId) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const base = (profileId !== undefined && profileBaseUrls.has(profileId)) ? profileBaseUrls.get(profileId) : BASE_URL;
  return base + url;
}

class FamilyDataManager {
  constructor() {
    this.people = [];
    this.peopleMap = new Map();
    this.profileCache = new Map(); // Cache for extended profiles
  }

  async load() {
    try {
      const response = await fetch('assets/data/people.json');
      const data = await response.json();
      this.people = data.people;
      this.people.forEach(person => {
        this.peopleMap.set(person.id, person);
      });
      return true;
    } catch (error) {
      console.error('Failed to load people data:', error);
      return false;
    }
  }

  async loadProfile(id) {
    if (this.profileCache.has(id)) {
      return this.profileCache.get(id);
    }

    const person = this.getPerson(id);
    if (!person || !person.profileFile) {
      return null;
    }

    const profilePath = `assets/data/profiles/${person.profileFile}.json`;

    // Try local first, then fall back to BASE_URL
    try {
      const localResponse = await fetch(profilePath);
      if (localResponse.ok) {
        const profile = await localResponse.json();
        profileBaseUrls.set(id, '');
        this.profileCache.set(id, profile);
        return profile;
      }
    } catch (e) { /* local not available */ }

    try {
      const remoteResponse = await fetch(`${BASE_URL}${profilePath}`);
      if (!remoteResponse.ok) return null;
      const profile = await remoteResponse.json();
      profileBaseUrls.set(id, BASE_URL);
      this.profileCache.set(id, profile);
      return profile;
    } catch (error) {
      return null;
    }
  }

  getPerson(id) {
    return this.peopleMap.get(id);
  }

  getAllPeople() {
    return this.people;
  }

  getRelation(personId, relationType) {
    const person = this.getPerson(personId);
    if (!person) return [];
    
    const relations = person[relationType] || [];
    return relations.map(id => this.getPerson(id)).filter(p => p);
  }

  getChildren(personId) {
    return this.getRelation(personId, 'children');
  }

  getParents(personId) {
    return this.getRelation(personId, 'parents');
  }

  getSiblings(personId) {
    const person = this.getPerson(personId);
    if (!person) return [];

    const siblingIds = new Set(person.siblings || []);
    if (person.parents && person.parents.length > 0) {
      person.parents.forEach(parentId => {
        const parent = this.getPerson(parentId);
        if (parent && parent.children && parent.children.length > 0) {
          parent.children.forEach(childId => {
            if (childId !== personId) {
              siblingIds.add(childId);
            }
          });
        }
      });
    }

    return Array.from(siblingIds)
      .map(id => this.getPerson(id))
      .filter(p => p);
  }

  getSpouse(personId) {
    const person = this.getPerson(personId);
    return person && person.spouse ? this.getPerson(person.spouse) : null;
  }
}

// Language management
class LanguageManager {
  constructor() {
    this.currentLang = localStorage.getItem('preferredLang') || 'he';
  }

  setLang(lang) {
    this.currentLang = lang;
    localStorage.setItem('preferredLang', lang);
    document.documentElement.setAttribute('lang', lang);
  }

  getLang() {
    return this.currentLang;
  }

  getText(obj, key) {
    if (this.currentLang === 'he') {
      return obj[key] || obj[key + 'En'] || '';
    } else {
      return obj[key + 'En'] || obj[key] || '';
    }
  }

  formatDate(dateStr) {
    if (!dateStr || dateStr === '?') return dateStr;
    
    // Check if it's a full date with slashes (MM/DD/YYYY format in database)
    const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dateMatch) {
      const [, month, day, year] = dateMatch;
      
      if (this.currentLang === 'he') {
        // Hebrew: DD/MM/YYYY (swap month and day from database)
        return `${day}/${month}/${year}`;
      } else {
        // English: MM/DD/YYYY (same as database format)
        return dateStr;
      }
    }
    
    // Not a full date (just year, or other format) - return as is
    return dateStr;
  }
}

// Global instances
const dataManager = new FamilyDataManager();
const langManager = new LanguageManager();

// Initialize language on page load
document.addEventListener('DOMContentLoaded', () => {
  langManager.setLang(langManager.getLang());
});
