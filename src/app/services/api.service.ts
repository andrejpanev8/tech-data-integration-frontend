import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private graphDbUrl = 'http://DESKTOP-IVUUMV3:7200/repositories/TechStoresDatav2';

  constructor(private http: HttpClient) { }

  /**
   * Main query to fetch paginated and filtered product data.
   * Made to handle category hierarchy properly.
   */
  getGraphData(
    limit: number,
    offset: number,
    categories: string[] = [],
    subCategories: string[] = [],
    endCategories: string[] = [],
    minPrice?: number | null,
    maxPrice?: number | null,
    minDiscount?: number | null,
    maxDiscount?: number | null,
    selectedStores: string[] = []
  ): Observable<any> {
    
    let categoryFilters = '';
    
    // Build hierarchical category filters
    if (endCategories.length > 0 || subCategories.length > 0 || categories.length > 0) {
      categoryFilters = `
        ?product :hasCategory ?cat .
        ?cat rdfs:label ?catName .
      `;
      
      // More complex filter that respects hierarchy
      const filterConditions = [];
      
      // If we have end categories selected, products must match them AND their parent hierarchy
      if (endCategories.length > 0) {
        const endCatValues = endCategories.map(c => `"${c}"`).join(',');
        filterConditions.push(`?catName IN (${endCatValues})`);
      }
      
      // If we have subcategories but no end categories, filter by subcategories
      else if (subCategories.length > 0) {
        const subCatValues = subCategories.map(c => `"${c}"`).join(',');
        filterConditions.push(`?catName IN (${subCatValues})`);
      }
      
      // If we only have top-level categories, filter by them
      else if (categories.length > 0) {
        const catValues = categories.map(c => `"${c}"`).join(',');
        filterConditions.push(`?catName IN (${catValues})`);
      }
      
      if (filterConditions.length > 0) {
        categoryFilters += `FILTER(${filterConditions.join(' || ')})`;
      }
    }

    // Store filters
    let storeFilters = '';
    if (selectedStores.length > 0) {
      const storeValues = selectedStores.map(s => `"${s}"`).join(',');
      storeFilters = `
        ?product :soldBy ?storeNode .
        ?storeNode rdfs:label ?storeName .
        FILTER(?storeName IN (${storeValues}))
      `;
    }

    // Price and discount filters
    let priceDiscountFilters = '';
    if (minPrice != null) priceDiscountFilters += `FILTER(xsd:decimal(?regularPrice) >= ${minPrice})\n`;
    if (maxPrice != null) priceDiscountFilters += `FILTER(xsd:decimal(?regularPrice) <= ${maxPrice})\n`;
    if (minDiscount != null) priceDiscountFilters += `FILTER(xsd:decimal(?discountPercent) >= ${minDiscount})\n`;
    if (maxDiscount != null) priceDiscountFilters += `FILTER(xsd:decimal(?discountPercent) <= ${maxDiscount})\n`;

    const sparqlQuery = `
    PREFIX : <http://www.semanticweb.org/andrej/ontologies/2025/7/products-ontology/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

    SELECT ?product ?title ?store ?fullCategory ?regularPrice ?discountedPrice ?discountPercent ?url ?totalCount
    WHERE {

      # --- Paginated data subquery ---
      {
        SELECT ?product ?title ?store (GROUP_CONCAT(DISTINCT ?categoryLabel; SEPARATOR=" > ") AS ?fullCategory)
              ?regularPrice ?discountedPrice ?discountPercent ?url
        WHERE {
          ?product a :Product .
          OPTIONAL { ?product :hasTitle ?title . }
          OPTIONAL { ?product :soldBy [ rdfs:label ?store ] . }
          OPTIONAL { ?product :hasRegularPrice ?regularPrice . }
          OPTIONAL { ?product :hasDiscountedPrice ?discountedPrice . }
          OPTIONAL { ?product :hasDiscountPercent ?discountPercent . }
          OPTIONAL { ?product :hasUrl ?url . }
          OPTIONAL { ?product :hasCategory ?anyCat . ?anyCat rdfs:label ?categoryLabel . }

          ${categoryFilters}
          ${storeFilters}
          ${priceDiscountFilters}
        }
        GROUP BY ?product ?title ?store ?regularPrice ?discountedPrice ?discountPercent ?url
        ORDER BY ?title
        LIMIT ${limit}
        OFFSET ${offset}
      }

      # --- Total count subquery ---
      {
        SELECT (COUNT(DISTINCT ?product) AS ?totalCount)
        WHERE {
          ?product a :Product .
          OPTIONAL { ?product :hasRegularPrice ?regularPrice . }
          OPTIONAL { ?product :hasDiscountPercent ?discountPercent . }
          OPTIONAL { ?product :hasCategory ?cat . ?cat rdfs:label ?catName . }
          OPTIONAL { ?product :soldBy ?storeNode . ?storeNode rdfs:label ?storeName . }

          ${categoryFilters}
          ${storeFilters}
          ${priceDiscountFilters}
        }
      }
    }`;

    return this.runSparql(sparqlQuery);
  }

  /** Fetch all top-level categories */
  getCategories(): Observable<any> {
    const query = `
      PREFIX : <http://www.semanticweb.org/andrej/ontologies/2025/7/products-ontology/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?categoryLabel WHERE {
        ?category a :Category ; rdfs:label ?categoryLabel .
        FILTER NOT EXISTS { ?anyParent :hasSubCategory ?category . }
      } ORDER BY ?categoryLabel`;
    return this.runSparql(query);
  }

  /** Fetch subcategories for a given top category */
  getSubCategories(category: string): Observable<any> {
    const query = `
      PREFIX : <http://www.semanticweb.org/andrej/ontologies/2025/7/products-ontology/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?subCategoryLabel WHERE {
        ?parentCategory rdfs:label "${category}" .
        ?parentCategory :hasSubCategory ?subCategory .
        ?subCategory rdfs:label ?subCategoryLabel .
      } ORDER BY ?subCategoryLabel`;
    return this.runSparql(query);
  }

  /** Fetch end categories for a given subcategory */
  getEndCategories(subCategory: string): Observable<any> {
    const query = `
      PREFIX : <http://www.semanticweb.org/andrej/ontologies/2025/7/products-ontology/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?endCategoryLabel WHERE {
        ?parentSub rdfs:label "${subCategory}" .
        ?parentSub :hasSubCategory ?endCategory .
        ?endCategory rdfs:label ?endCategoryLabel .
      } ORDER BY ?endCategoryLabel`;
    return this.runSparql(query);
  }

  /** Fetch all stores */
  getStores(): Observable<any> {
    const query = `
    PREFIX : <http://www.semanticweb.org/andrej/ontologies/2025/7/products-ontology/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    
    SELECT DISTINCT ?storeLabel WHERE {
      ?store a :Store ;
             rdfs:label ?storeLabel .
    }
    ORDER BY ?storeLabel
  `;
    return this.runSparql(query);
  }

  /** Helper to run any SPARQL query */
  private runSparql(query: string): Observable<any> {
    const headers = new HttpHeaders({
      'Accept': 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded'
    });
    const body = new HttpParams().set('query', query);
    return this.http.post(this.graphDbUrl, body.toString(), { headers });
  }
}