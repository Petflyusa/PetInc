// Try dotenv first, then fall back to config.json
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mysql = require('mysql2/promise');

// Fallback to config.json if env vars not set
const config = (() => {
  try {
    return require('./config.json');
  } catch { return null; }
})();

const dbConfig = {
  host: process.env.DB_HOST || (config && config.db.host),
  port: parseInt(process.env.DB_PORT) || (config && config.db.port) || 3306,
  user: process.env.DB_USER || (config && config.db.user),
  password: process.env.DB_PASSWORD || (config && config.db.password),
  database: process.env.DB_NAME || (config && config.db.database),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function initializeDatabase() {
  // Create quote_requests table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS quote_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pet_type VARCHAR(50),
      pet_name VARCHAR(100),
      pet_weight VARCHAR(20),
      breed VARCHAR(100),
      origin_country VARCHAR(100),
      origin_city VARCHAR(100),
      dest_country VARCHAR(100),
      dest_city VARCHAR(100),
      travel_date DATE,
      transport_type VARCHAR(50),
      contact_name VARCHAR(100),
      email VARCHAR(150),
      phone VARCHAR(50),
      referral VARCHAR(100),
      notes TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create contact_messages table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(150),
      phone VARCHAR(50),
      subject VARCHAR(200),
      message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create country_regulations table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS country_regulations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      country_code VARCHAR(10),
      country_name VARCHAR(100),
      pet_types TEXT,
      microchip TEXT,
      rabies_vaccination TEXT,
      health_certificate TEXT,
      import_permit TEXT,
      quarantine_days INT DEFAULT 0,
      additional_requirements TEXT,
      preparation_time VARCHAR(100),
      restricted_breeds TEXT,
      contact_info TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create airline_regulations table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS airline_regulations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      airline_name VARCHAR(100),
      carry_on TEXT,
      checked_bag TEXT,
      cargo TEXT,
      pet_fee VARCHAR(100),
      size_limits TEXT,
      breed_restrictions TEXT,
      booking_info TEXT,
      crate_requirements TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create clients table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) UNIQUE,
      password VARCHAR(255),
      full_name VARCHAR(150),
      email VARCHAR(150),
      phone VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create client_pets table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS client_pets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id INT,
      pet_name VARCHAR(100),
      pet_type VARCHAR(50),
      breed VARCHAR(100),
      weight VARCHAR(20),
      microchip VARCHAR(50),
      photo_url VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create client_services table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS client_services (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id INT,
      pet_id INT,
      origin_country VARCHAR(100),
      origin_city VARCHAR(100),
      dest_country VARCHAR(100),
      dest_city VARCHAR(100),
      transport_type VARCHAR(50),
      travel_date DATE,
      current_status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create service_sop table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS service_sop (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_id INT,
      stage VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pending',
      completed_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create client_messages table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS client_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id INT,
      sender VARCHAR(50),
      subject VARCHAR(200),
      message TEXT,
      is_read TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed country_regulations if empty
  const [countryCount] = await pool.execute('SELECT COUNT(*) as count FROM country_regulations');
  if (countryCount[0].count === 0) {
    const countries = [
      {
        country_code: 'GB',
        country_name: 'United Kingdom',
        pet_types: 'Dogs, Cats',
        microchip: 'ISO 11784/11785 compliant 15-digit microchip required',
        rabies_vaccination: 'Rabies vaccination at least 21 days before travel',
        health_certificate: 'Animal Health Certificate (AHC) issued within 10 days of travel',
        import_permit: 'Not required for pet travel from EU countries',
        quarantine_days: 0,
        additional_requirements: 'Tapeworm treatment 1-5 days before travel for dogs. Dogs must be at least 15 weeks old.',
        preparation_time: 'At least 4 weeks',
        restricted_breeds: 'Pit Bull Terriers, Japanese Tosa, Dogo Argentino, Fila Brasileiro prohibited',
        contact_info: 'DEFRA: +44 (0) 3000 200 300 | www.gov.uk/bring-pet-to-uk'
      },
      {
        country_code: 'JP',
        country_name: 'Japan',
        pet_types: 'Dogs, Cats',
        microchip: 'ISO 11784/11785 compliant 15-digit microchip mandatory',
        rabies_vaccination: 'Two rabies vaccinations required, second given 30+ days after first',
        health_certificate: 'Inspection Certificate issued within 10 days of export',
        import_permit: 'Advance notification to Animal Quarantine Service required 40+ days before',
        quarantine_days: 180,
        additional_requirements: 'Blood titer test required. Waiting period varies by country of origin. Facilities inspection may reduce quarantine.',
        preparation_time: 'At least 7 months',
        restricted_breeds: 'Some dog breeds have restrictions. Japanese breeds require additional documentation.',
        contact_info: 'MAFF Animal Quarantine Service: +81 92-476-9200 | www.maff.go.jp/aqs/'
      },
      {
        country_code: 'AU',
        country_name: 'Australia',
        pet_types: 'Dogs, Cats',
        microchip: 'ISO microchip mandatory, must be implanted before rabies vaccination',
        rabies_vaccination: 'Rabies vaccination required after microchip implantation',
        health_certificate: 'International Health Certificate and Export Permit from country of origin',
        import_permit: 'Import permit required from Department of Agriculture. Apply 6+ months in advance.',
        quarantine_days: 10,
        additional_requirements: 'Must come from approved countries. Multiple tests required (rabies, brucellosis, leptospirosis). Extended stay in approved facility may be required.',
        preparation_time: 'At least 6-8 months',
        restricted_breeds: 'Pit Bull Terrier and American Pit Bull Terrier banned. Dingo crosses, Fila Brasileiro, Japanese Tosa, and Togaware dogs prohibited.',
        contact_info: 'Department of Agriculture: +61 1800 900 090 | www.agriculture.gov.au/cantos'
      },
      {
        country_code: 'SG',
        country_name: 'Singapore',
        pet_types: 'Dogs, Cats',
        microchip: 'ISO 11784/11785 compliant microchip required',
        rabies_vaccination: 'Rabies vaccination required at least 30 days before travel but not more than 1 year',
        health_certificate: 'Health certificate from licensed veterinarian issued within 7 days of travel',
        import_permit: 'Import licence required from AVS. Application 1 month before import.',
        quarantine_days: 30,
        additional_requirements: 'Category A countries: minimal quarantine. Category B: 30+ days. Category C: 30-60 days with additional requirements.',
        preparation_time: 'At least 4 months',
        restricted_breeds: 'Pit Bull (including American Pit Bull Terrier), Akita, Boar Dog, Neapolitan Mastiff, Dogo Argentino, Fila Brasileiro, and crosses prohibited.',
        contact_info: 'AVS: +65 1800-476-1600 | www.nparks.gov.sg/animals'
      },
      {
        country_code: 'CA',
        country_name: 'Canada',
        pet_types: 'Dogs, Cats',
        microchip: 'Not mandatory but recommended',
        rabies_vaccination: 'Rabies vaccination required for dogs 3+ months old from the US (varies by province)',
        health_certificate: 'Health certificate or veterinary certificate required',
        import_permit: 'Cats and dogs from US: rabies certificate required. Other countries: permit may be required.',
        quarantine_days: 0,
        additional_requirements: 'Dogs must appear healthy and free of disease. Some provinces have additional requirements. Commercial imports have stricter rules.',
        preparation_time: 'At least 2-4 weeks',
        restricted_breeds: 'Pit Bulls banned in Ontario. Breeds restricted in some municipalities.',
        contact_info: 'CFIA: +1 800-442-2342 | www.inspection.gc.ca/animals'
      }
    ];

    for (const country of countries) {
      await pool.execute(`
        INSERT INTO country_regulations 
        (country_code, country_name, pet_types, microchip, rabies_vaccination, health_certificate, import_permit, quarantine_days, additional_requirements, preparation_time, restricted_breeds, contact_info)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        country.country_code, country.country_name, country.pet_types, country.microchip,
        country.rabies_vaccination, country.health_certificate, country.import_permit,
        country.quarantine_days, country.additional_requirements, country.preparation_time,
        country.restricted_breeds, country.contact_info
      ]);
    }
  }

  // Seed airline_regulations if empty
  const [airlineCount] = await pool.execute('SELECT COUNT(*) as count FROM airline_regulations');
  if (airlineCount[0].count === 0) {
    const airlines = [
      {
        airline_name: 'United Airlines',
        carry_on: 'Pets allowed in cabin on select routes. Pet must fit in soft-sided carrier under seat.',
        checked_bag: 'Pets can travel as checked baggage on international flights to/from some destinations.',
        cargo: 'United PetSafe program for cargo transport. Available for international routes.',
        pet_fee: 'Cabin: $125 USD each way. Checked: $200 USD each way. Cargo: varies by weight.',
        size_limits: 'Cabin: Carrier max 18" L x 11" W x 11" H. Combined pet + carrier max 25 lbs.',
        breed_restrictions: 'Snub-nosed (brachycephalic) breeds not accepted for cargo. Some breeds restricted in cabin.',
        booking_info: 'Book through United PetSafe: 1-800-575-3335. Reserve early as space is limited.',
        crate_requirements: 'IATA-compliant crate required. Must be leak-proof, well-ventilated, secure door.'
      },
      {
        airline_name: 'Emirates',
        carry_on: 'Limited cabin service. Only falcons and hunting birds permitted in cabin on certain routes.',
        checked_bag: 'Pets accepted as checked baggage on select flights. Service not available on all routes.',
        cargo: 'Emirates SkyCargo handles live animals for most destinations. Contact cargo office.',
        pet_fee: 'Varies by route and pet size. Contact Emirates for specific quotes.',
        size_limits: 'Cargo: varies by aircraft. Cabin: falcons max 3 per person on permitted routes.',
        breed_restrictions: 'Snub-nosed dogs and cats not accepted for cargo. Breeding pairs may be restricted.',
        booking_info: 'Contact Emirates cargo or your travel agent at least 72 hours before departure.',
        crate_requirements: 'IATA-compliant crate required. Wooden crate required for snub-nosed breeds in cargo.'
      },
      {
        airline_name: 'Singapore Airlines',
        carry_on: 'Cabin pets not permitted on most flights. Exception: Snakes in cabin for designated routes.',
        checked_bag: 'Pets as checked baggage on select flights within Asia and to/from approved destinations.',
        cargo: 'Singapore Airlines Cargo handles live animal transport to many destinations worldwide.',
        pet_fee: 'Checked baggage: $200-$300 SGD depending on size and route. Cargo: quoted separately.',
        size_limits: 'Checked: combined weight of pet + crate max 32kg. Check specific aircraft limits.',
        breed_restrictions: 'Snub-nosed breeds not accepted for cargo transport. Age restrictions apply.',
        booking_info: 'Contact SQ cargo or your freight forwarder. Advance booking required.',
        crate_requirements: 'IATA-compliant crate with proper ventilation, secure latches, absorbent bedding.'
      },
      {
        airline_name: 'Lufthansa',
        carry_on: 'Small pets (cats, dogs) in IATA-compliant carrier under seat. Max 8kg combined.',
        checked_bag: 'Pets as checked baggage in hold. Lufthansa Cargo for larger animals.',
        cargo: 'Lufthansa Cargo handles live animal transport. Book through cargo or approved forwarders.',
        pet_fee: 'Cabin: €70-90 EUR each way. Checked: €100-200 EUR each way depending on size.',
        size_limits: 'Cabin: carrier max 55cm x 40cm x 23cm. Combined weight max 8kg. Checked: max 75kg total.',
        breed_restrictions: 'Snub-nosed breeds not accepted for cargo due to breathing risks.',
        booking_info: 'Book through Lufthansa Pet Desk or cargo. Reserve well in advance.',
        crate_requirements: 'IATA-compliant rigid crate. Must allow pet to stand, turn, lie down comfortably.'
      },
      {
        airline_name: 'British Airways',
        carry_on: 'Cabin pets not permitted on most flights.',
        checked_bag: 'Pets can travel as checked baggage on routes where British Airways handles animals.',
        cargo: 'pets website for cargo transport. Book through approved pet transport agents.',
        pet_fee: 'Varies by route and kennel size. Generally £200-500+ for international travel.',
        size_limits: 'British Airways can only accept pets in holds on routes where facilities exist.',
        breed_restrictions: 'Snub-nosed breeds not accepted for cargo. Some breed restrictions apply.',
        booking_info: 'Contact British Airways directly or use specialized pet transport agents.',
        crate_requirements: 'IATA-compliant crate with adequate ventilation, secure fastenings, food/water bowls.'
      }
    ];

    for (const airline of airlines) {
      await pool.execute(`
        INSERT INTO airline_regulations 
        (airline_name, carry_on, checked_bag, cargo, pet_fee, size_limits, breed_restrictions, booking_info, crate_requirements)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        airline.airline_name, airline.carry_on, airline.checked_bag, airline.cargo,
        airline.pet_fee, airline.size_limits, airline.breed_restrictions,
        airline.booking_info, airline.crate_requirements
      ]);
    }
  }
}

module.exports = { pool, query, initializeDatabase };
