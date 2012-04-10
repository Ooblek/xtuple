// ==========================================================================
// Project:   xTuple Postbooks - Business Management System Framework        
// Copyright: ©2012 OpenMFG LLC, d/b/a xTuple                             
// ==========================================================================

/*globals XM */

sc_require('mixins/_cash_receipt');
sc_require('models/cash_receipt_application');

/**
  @class

  @extends XM.Document
*/
XM.CashReceipt = XM.Document.extend(XM._CashReceipt,
  /** @scope XM.CashReceipt.prototype */ {

  numberPolicy: XT.AUTO_NUMBER,

  applications: [],
  
  /** @private */
  applicationsLength: 0,
  
  /** @private */
  applicationsLengthBinding: SC.Binding.from('*applications.length').oneWay().noDelay(),

  /** @private */
  detailsLength: 0,
  
  /** @private */
  detailsLengthBinding: SC.Binding.from('*details.length').oneWay().noDelay(),
  
  /** @private */
  receivablesLength: 0,
  
  /** @private */
  receivablesLengthBinding: SC.Binding.from('*receivables.length').oneWay().noDelay(),
  
  /**
    Total amount applied.
  */
  applied: 0,
  
  /**
    Total discount taken.
    
    @type Number
  */
  discount: 0,
  
  /**
    Indicates whether to include outstanding credit memos in applications array.
    
    @type Boolean
    @default false
  */
  includeCredits: false,
  
  // .................................................
  // CALCULATED PROPERTIES
  //
  
  /**
    Total unapplied.
  */
  balance: function() {
    var amount = this.get('amount') || 0,
        applied = this.get('applied');
        
    return SC.Math.round(amount - applied, XT.MONEY_SCALE);
  }.property('amount', 'applied').cacheable(),
  
  /**
    Return filtered applications result determined by 'includeCredits' property
    and sorted by due date.
  */
  filteredApplications: function() {
    var applications = this.get('applications'),
        includeCredits = this.get('includeCredits'),
        ret;
        
    // filter results
    ret = applications.filter(function(application) {
      var documentType = application.getPath('receivable.documentType');

      return application.get('applied') > 0 || 
             includeCredits ||
             documentType === XM.Receivable.INVOICE ||
             documentType === XM.Receivable.DEBIT_MEMO;
    }, this);
    
    // define sort on due date
    sortfunc = function(a,b) {
      var aDate = a.getPath('receivable.dueDate'),
          bDate = b.getPath('receivable.dueDate');
      return SC.DateTime.compareDate(aDate, bDate);
    }
    
    return ret.sort(sortfunc);
  }.property('includeCredits', 'applicationsLength').cacheable(),
  
  /**
    
  */
  receivables: function() {
    if (!this._xm_receivables) this._xm_receivables = [];
    var customer = this.get('customer'),
        isPosted = this.get('isPosted'),
        store = this.get('store');

    // get receivables according to situation   
    if (customer && isPosted === false) {
      if (!this._xm_query) {
        this._xm_query = SC.Query.local(XM.CashReceiptReceivable, {
          conditions: "customer = {customer} AND isOpen = YES",
          orderBy: "dueDate"
        })
      }
      this._xm_query.setIfChanged('parameters', { customer: customer });
      this._xm_receivables = store.find(this._xm_query);
      return this._xm_receivables;
    } 
    return [];
  }.property('customer', 'isPosted').cacheable(),
  
  //..................................................
  // METHODS
  //
  
  /**
    Update the amount applied.
    
    @param {Number} amount to add
    @returns Number
  */
  updateApplied: function(amount) {
    var applied = SC.Math.round(this.get('applied') + amount, XT.MONEY_SCALE);
    this.set('applied', applied);
    return applied;
  },

  /**
    Update the discount taken.
    
    @param {Number} amount to add
    @returns Number
  */  
  updateDiscount: function(amount) {
    var discount = SC.Math.round(this.get('discount') + amount, XT.MONEY_SCALE);
    this.set('discount', discount);
    return discount;
  },

  //..................................................
  // OBSERVERS
  //
  
  customerDidChange: function() {
    if (this.get('customer')) this.customer.set('isEditable', false);
  }.observes('customer'),
  
  detailsLengthDidChange: function() {
    var details = this.get('details'),
        applications = this.get('applications'),
        isUpdated = false,
        isNotFixedCurrency = details.get('length') ? false : true;

    // currency is only editable when no detail
    this.currency.set('isEditable', isNotFixedCurrency);
    this.currencyRate.set('isEditable', isNotFixedCurrency);
    
    // process detail
    for (var i = 0; i < details.get('length'); i++) {
      var detail = details.objectAt(i),
          receivable = detail.get('receivable'),
          application = applications.findProperty('receivable', receivable),
          status = detail.get('status');
          
      // if not found make one
      if ((status & SC.Record.DESTROYED) === 0) {
        if (!application) {
          application = XM.CashReceiptApplication.create();
          application.set('cashReceipt', this),
          application.set('cashReceiptDetail', detail),
          application.set('receivable', receivable),
          applications.pushObject(application);
          isUpdated = true;
          
        // if found, add detail if necessary
        } else if (!application.get('cashReceiptDetail')) {
          application.set('cashReceiptDetail', detail);
          isUpdated = true;
        }
        
        // Update the cash receipt totals
        if (isUpdated) {
          this.updateApplied(application.get('applied'));
          this.updateDiscount(application.get('discount'));
        }
      }
    }
  }.observes('detailsLength').cacheable(),

  receivablesLengthDidChange: function() {
    var receivables = this.get('receivables'),
        applications = this.get('applications');

    // process
    for (var i = 0; i < receivables.get('length'); i++) {
      var receivable = receivables.objectAt(i),
          application = applications.findProperty('receivable', receivable);
          
      // if not found make one
      if (!application) {
        application = XM.CashReceiptApplication.create();
        application.set('cashReceipt', this);
        application.set('receivable', receivable);
        applications.pushObject(application);
      }
    }
  }.observes('receivablesLength').cacheable()

});

XM.CashReceipt.mixin( /** @scope XM.CashReceipt */ {

/**
  Check funds type.
  
  @static
  @constant
  @type String
  @default C
*/
  CHECK: 'C',

/**
  Certified Check funds type.
  
  @static
  @constant
  @type String
  @default T
*/
  CERTIFIED_CHECK: 'T',

/**
  Master Card funds type.
  
  @static
  @constant
  @type String
  @default M
*/
  MASTER_CARD: 'M',
  
/**
  Visa funds type.
  
  @static
  @constant
  @type String
  @default V
*/
  VISA: 'V',

/**
  American Express funds type.
  @static
  @constant
  @type String
  @default A
*/
  AMERICAN_EXPRESS: 'A',
  
/**
  Discover card funds type.
  
  @static
  @constant
  @type String
  @default D
*/
  DISCOVER_CARD: 'D',

/**
  Other credit card funds type.
  @static
  @constant
  @type String
  @default R
*/
  OTHER_CREDIT_CARD: 'R',
  
/**
  Cash funds type.
  
  @static
  @constant
  @type String
  @default K
*/
  CASH: 'K',

/**
  Customer Deposit document type.
  @static
  @constant
  @type String
  @default W
*/
  WIRE_TRANSFER: 'W',
  
/**
  Other funds type.
  @static
  @constant
  @type String
  @default O
*/
  OTHER: 'O'

});

