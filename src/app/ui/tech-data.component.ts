import { ElementRef, Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../services/api.service';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

// Interface for the structure of a single binding in a SPARQL response
export interface SparqlBinding {
  [key: string]: {
    type: string;
    value: string;
  };
}

@Component({
  selector: 'app-tech-data',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tech-data.component.html',
  styleUrls: ['./tech-data.component.css']
})
export class TechDataComponent implements OnInit {
  // Dropdown data sources
  public categories: string[] = [];
  public subCategories: string[] = [];
  public endCategories: string[] = [];
  public stores: string[] = [];

  // Models for selected filter values
  public selectedCategories: string[] = [];
  public selectedSubCategories: string[] = [];
  public selectedEndCategories: string[] = [];
  public selectedStores: string[] = [];

  // Price & Discount filters
  public minPrice: number | null = null;
  public maxPrice: number | null = null;
  public minDiscount: number | null = null;
  public maxDiscount: number | null = null;

  // Table data and state management
  public tableData: SparqlBinding[] = [];
  public isLoading = true;
  public error: string | null = null;

  // Pagination state
  public pageSize = 30;
  public currentPage = 1;
  public totalPages = 1;

  // UI state for dropdown visibility
  public dropdownOpen = {
    category: false,
    sub: false,
    end: false,
    store: false
  };

  constructor(private apiService: ApiService, private elementRef: ElementRef) { }

  ngOnInit(): void {
    this.loadInitialCategories();
    this.loadStores();
    this.fetchData();
  }


  // Fetches the initial top-level categories to populate the first dropdown.
  loadInitialCategories(): void {
    this.apiService.getCategories().subscribe({
      next: (response) => {
        // Correctly map the response using 'categoryLabel'
        this.categories = response.results.bindings.map((b: SparqlBinding) => b['categoryLabel'].value);
      },
      error: (err) => {
        console.error('Failed to fetch top-level categories:', err);
        this.error = 'Could not load categories.';
      }
    });
  }

  loadStores(): void {
    this.apiService.getStores().subscribe({
      next: (response) => {
        this.stores = response.results.bindings.map((b: SparqlBinding) => b['storeLabel'].value);
      },
      error: (err) => {
        console.error('Failed to fetch stores:', err);
        this.error = 'Could not load stores.';
      }
    });
  }

  // Method for handling dropdown toggles
  onDropdownToggle(event: Event, type: 'category' | 'sub' | 'end' | 'store') {
    event.stopPropagation();
    
    // Close all other dropdowns first
    Object.keys(this.dropdownOpen).forEach(key => {
      if (key !== type) {
        this.dropdownOpen[key as keyof typeof this.dropdownOpen] = false;
      }
    });
    
    // Toggle the clicked dropdown
    this.dropdownOpen[type] = !this.dropdownOpen[type];
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    
    const target = event.target as HTMLElement;
    
    if (target) {
      // Check multiple ways to detect if click is inside dropdown area
      const isInsideComponent = this.elementRef.nativeElement.contains(target);
      const isDropdownElement = target.classList.contains('dropdown') || 
                                target.classList.contains('dropdown-selected') || 
                                target.classList.contains('dropdown-menu') ||
                                target.closest('.dropdown') !== null;
      const isCheckboxOrLabel = target.tagName === 'INPUT' || target.tagName === 'LABEL';
      
      
      // Close dropdowns only if click is completely outside dropdown areas
      if (!isInsideComponent || (!isDropdownElement && !isCheckboxOrLabel)) {
        this.closeAllDropdowns();
      }
    }
  }

  // Helper method to close all dropdowns
  private closeAllDropdowns(): void {
    this.dropdownOpen.category = false;
    this.dropdownOpen.sub = false;
    this.dropdownOpen.end = false;
    this.dropdownOpen.store = false;
  }

  /**
   * Handles changes in the top-level category selection.
   * It updates the selected list and triggers loading of subcategories.
   */
  onCategoryChange(category: string, event: Event) {
    event.stopPropagation(); // Prevent dropdown from closing
    const isChecked = (event.target as HTMLInputElement).checked;
    if (isChecked) {
      this.selectedCategories.push(category);
    } else {
      this.selectedCategories = this.selectedCategories.filter(c => c !== category);
    }
    // Refresh subcategories based on the new selection
    this.loadSubCategories();
  }

  onStoreChange(store: string, event: Event) {
    event.stopPropagation(); // Prevent dropdown from closing
    const isChecked = (event.target as HTMLInputElement).checked;
    if (isChecked) {
      this.selectedStores.push(store);
    } else {
      this.selectedStores = this.selectedStores.filter(s => s !== store);
    }
  }

  /**
   * Fetches subcategories for all selected top-level categories.
   * Uses forkJoin to handle multiple API calls concurrently.
   */
  loadSubCategories(): void {
    // Clear downstream selections and data
    this.subCategories = [];
    this.selectedSubCategories = [];
    this.endCategories = [];
    this.selectedEndCategories = [];

    if (this.selectedCategories.length === 0) {
      return; // Nothing to load
    }

    // Create an array of observables for each selected category
    const subCategoryObservables = this.selectedCategories.map(cat =>
      this.apiService.getSubCategories(cat).pipe(
        map(response => response.results.bindings.map((b: SparqlBinding) => b['subCategoryLabel'].value)),
        catchError(() => of([])) // On error, return an empty array for that call
      )
    );

    // Execute all calls and process the results
    forkJoin(subCategoryObservables).subscribe(results => {
      // Flatten the array of arrays and remove duplicates
      const allSubCategories = results.flat();
      this.subCategories = [...new Set(allSubCategories)];
    });
  }

  /**
   * Handles changes in the subcategory selection.
   */
  onSubCategoryChange(subCategory: string, event: Event) {
    event.stopPropagation(); // Prevent dropdown from closing
    const isChecked = (event.target as HTMLInputElement).checked;
    if (isChecked) {
      this.selectedSubCategories.push(subCategory);
    } else {
      this.selectedSubCategories = this.selectedSubCategories.filter(s => s !== subCategory);
    }
    this.loadEndCategories();
  }

  /**
   * Fetches end-level categories for all selected subcategories.
   */
  loadEndCategories(): void {
    this.endCategories = [];
    this.selectedEndCategories = [];

    if (this.selectedSubCategories.length === 0) {
      return;
    }

    const endCategoryObservables = this.selectedSubCategories.map(sub =>
      this.apiService.getEndCategories(sub).pipe(
        map(response => response.results.bindings.map((b: SparqlBinding) => b['endCategoryLabel'].value)),
        catchError(() => of([]))
      )
    );

    forkJoin(endCategoryObservables).subscribe(results => {
      const allEndCategories = results.flat();
      this.endCategories = [...new Set(allEndCategories)];
    });
  }

  /**
   * Handles changes in the end-category selection.
   */
  onEndCategoryChange(endCategory: string, event: Event) {
    event.stopPropagation(); // Prevent dropdown from closing
    const isChecked = (event.target as HTMLInputElement).checked;
    if (isChecked) {
      this.selectedEndCategories.push(endCategory);
    } else {
      this.selectedEndCategories = this.selectedEndCategories.filter(e => e !== endCategory);
    }
  }

  /**
   * Removes a selected category chip and updates the dependent filters.
   */
  removeChip(type: 'category' | 'sub' | 'end' | 'store', value: string) {
    switch (type) {
      case 'category':
        this.selectedCategories = this.selectedCategories.filter(c => c !== value);
        this.loadSubCategories(); // This will clear end-categories
        break;
      case 'sub':
        this.selectedSubCategories = this.selectedSubCategories.filter(s => s !== value);
        this.loadEndCategories(); // This will clear end-categories
        break;
      case 'end':
        this.selectedEndCategories = this.selectedEndCategories.filter(e => e !== value);
        break;
      case 'store':
        this.selectedStores = this.selectedStores.filter(s => s !== value);
        break;
    }
  }

  /**
   * Applies all selected filters and fetches the corresponding data.
   */
  applyFilters(): void {
    this.currentPage = 1;
    this.fetchData();
  }

  /**
   * Fetches the main product data from the API based on current filters and pagination.
   */
  fetchData(): void {
    this.isLoading = true;
    this.error = null;
    const offset = (this.currentPage - 1) * this.pageSize;

    this.apiService.getGraphData(
      this.pageSize,
      offset,
      this.selectedCategories,
      this.selectedSubCategories,
      this.selectedEndCategories,
      this.minPrice,
      this.maxPrice,
      this.minDiscount,
      this.maxDiscount,
      this.selectedStores
    ).subscribe({
      next: (response) => {
        this.tableData = response.results.bindings;
        this.totalPages = Math.ceil(+this.tableData[0]['totalCount'].value / this.pageSize) || 1;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = 'Failed to fetch data from GraphDB. Please try again.';
        this.isLoading = false;
        console.error(err);
      }
    });
  }

  /** Pagination controls */
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.fetchData();
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.fetchData();
    }
  }

  goToPage(event: Event): void {
    const input = event.target as HTMLInputElement;
    let page = Number(input.value);
    if (isNaN(page) || page < 1) page = 1;
    if (page > this.totalPages) page = this.totalPages;
    this.currentPage = page;
    this.fetchData();
  }
}