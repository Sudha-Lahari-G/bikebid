"""Realistic used-motorcycle listings for seeding and the always-on demo.

Prices are rough Indian used-market values in rupees for a 2-3 year old bike.
"""

import random
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.models import BikeCondition
from app.schemas import AuctionCreate, MotorcycleIn


@dataclass(frozen=True)
class CatalogBike:
    make: str
    model: str
    engine_cc: int
    value: int
    style: str


CATALOG: tuple[CatalogBike, ...] = (
    CatalogBike("Royal Enfield", "Classic 350", 349, 165_000, "retro"),
    CatalogBike("Royal Enfield", "Bullet 350", 346, 150_000, "retro"),
    CatalogBike("Royal Enfield", "Himalayan 450", 452, 260_000, "adventure"),
    CatalogBike("Royal Enfield", "Interceptor 650", 648, 270_000, "retro"),
    CatalogBike("Royal Enfield", "Continental GT 650", 648, 285_000, "cafe racer"),
    CatalogBike("Royal Enfield", "Meteor 350", 349, 180_000, "cruiser"),
    CatalogBike("Royal Enfield", "Hunter 350", 349, 140_000, "roadster"),
    CatalogBike("Royal Enfield", "Super Meteor 650", 648, 330_000, "cruiser"),
    CatalogBike("KTM", "390 Duke", 373, 250_000, "naked"),
    CatalogBike("KTM", "200 Duke", 199, 160_000, "naked"),
    CatalogBike("KTM", "RC 390", 373, 260_000, "sport"),
    CatalogBike("KTM", "390 Adventure", 373, 290_000, "adventure"),
    CatalogBike("Bajaj", "Pulsar NS200", 199, 120_000, "naked"),
    CatalogBike("Bajaj", "Dominar 400", 373, 190_000, "tourer"),
    CatalogBike("Bajaj", "Pulsar 220F", 220, 110_000, "sport"),
    CatalogBike("Bajaj", "Avenger 220 Cruise", 220, 105_000, "cruiser"),
    CatalogBike("Honda", "CB350 H'ness", 348, 190_000, "retro"),
    CatalogBike("Honda", "CBR650R", 649, 850_000, "sport"),
    CatalogBike("Honda", "CB300R", 286, 230_000, "naked"),
    CatalogBike("Honda", "Africa Twin", 1084, 1_400_000, "adventure"),
    CatalogBike("Yamaha", "YZF-R15 V4", 155, 160_000, "sport"),
    CatalogBike("Yamaha", "MT-15", 155, 140_000, "naked"),
    CatalogBike("Yamaha", "FZ-S V3", 149, 100_000, "commuter"),
    CatalogBike("Yamaha", "YZF-R3", 321, 380_000, "sport"),
    CatalogBike("TVS", "Apache RR 310", 312, 230_000, "sport"),
    CatalogBike("TVS", "Apache RTR 160 4V", 159, 105_000, "naked"),
    CatalogBike("TVS", "Ronin", 225, 125_000, "roadster"),
    CatalogBike("Hero", "Xpulse 200 4V", 199, 120_000, "adventure"),
    CatalogBike("Hero", "Splendor Plus", 97, 60_000, "commuter"),
    CatalogBike("Suzuki", "Gixxer SF 250", 249, 160_000, "sport"),
    CatalogBike("Suzuki", "V-Strom 650XT", 645, 750_000, "adventure"),
    CatalogBike("Suzuki", "Hayabusa", 1340, 1_500_000, "hyperbike"),
    CatalogBike("Kawasaki", "Ninja 300", 296, 280_000, "sport"),
    CatalogBike("Kawasaki", "Z900", 948, 800_000, "naked"),
    CatalogBike("Kawasaki", "Ninja ZX-10R", 998, 1_500_000, "superbike"),
    CatalogBike("Triumph", "Street Triple RS", 765, 1_000_000, "naked"),
    CatalogBike("Triumph", "Speed 400", 398, 220_000, "roadster"),
    CatalogBike("Triumph", "Bonneville T120", 1200, 1_000_000, "retro"),
    CatalogBike("Harley-Davidson", "X440", 440, 230_000, "roadster"),
    CatalogBike("Harley-Davidson", "Iron 883", 883, 700_000, "cruiser"),
    CatalogBike("Harley-Davidson", "Fat Boy 114", 1868, 1_800_000, "cruiser"),
    CatalogBike("BMW", "G 310 R", 313, 250_000, "naked"),
    CatalogBike("BMW", "S 1000 RR", 999, 1_800_000, "superbike"),
    CatalogBike("Ducati", "Monster", 937, 950_000, "naked"),
    CatalogBike("Ducati", "Panigale V2", 955, 1_500_000, "superbike"),
    CatalogBike("Jawa", "42", 293, 150_000, "retro"),
    CatalogBike("Yezdi", "Adventure", 334, 180_000, "adventure"),
    CatalogBike("Husqvarna", "Svartpilen 401", 399, 230_000, "scrambler"),
)

CITIES = (
    "Bengaluru, KA", "Hyderabad, TS", "Mumbai, MH", "Pune, MH", "Chennai, TN", "Delhi, DL",
    "Gurugram, HR", "Kolkata, WB", "Ahmedabad, GJ", "Jaipur, RJ", "Kochi, KL", "Chandigarh, CH",
    "Goa, GA", "Indore, MP", "Lucknow, UP", "Visakhapatnam, AP",
)
COLORS = (
    "Stealth Black", "Racing Red", "Pearl White", "Gunmetal Grey", "Electric Blue", "Desert Sand",
    "Forest Green", "Matte Orange", "Chrome Silver", "Midnight Blue",
)
_CONDITION_FACTOR = {
    BikeCondition.EXCELLENT: 1.0,
    BikeCondition.GOOD: 0.88,
    BikeCondition.FAIR: 0.72,
    BikeCondition.PROJECT: 0.5,
}
_CONDITION_NOTES = {
    BikeCondition.EXCELLENT: "Showroom condition, garage kept and never dropped.",
    BikeCondition.GOOD: "Well maintained with minor cosmetic marks consistent with age.",
    BikeCondition.FAIR: "Runs and rides well; some scratches and worn consumables.",
    BikeCondition.PROJECT: "Needs work — ideal for a restoration or custom build.",
}
_EXTRAS = (
    "Full service history from the authorised service centre.",
    "New tyres fitted within the last 2,000 km.",
    "Single owner, all documents and both keys available.",
    "Fresh chain and sprocket kit, recently serviced.",
    "Comes with crash guards, tank pad and a phone mount.",
    "Insurance valid for another 8 months.",
    "Aftermarket exhaust installed; stock exhaust included.",
    "Touring setup: saddle stays, top box and a taller windscreen.",
    "Never used on track; ridden mostly on weekends.",
)


def _round_to(value: float, step: int) -> int:
    return max(step, int(round(value / step)) * step)


def increment_for(price: int) -> int:
    if price < 100_000:
        return 500
    if price < 500_000:
        return 1_000
    if price < 1_000_000:
        return 2_500
    return 5_000


def random_listing(
    rng: random.Random, *, starts_at: datetime, duration: timedelta, current_year: int
) -> AuctionCreate:
    bike = rng.choice(CATALOG)
    condition = rng.choices(list(BikeCondition), weights=(4, 6, 3, 1))[0]
    age = rng.randint(0, 9)
    year = current_year - age
    mileage = _round_to(age * rng.randint(3_000, 9_000) + rng.randint(300, 3_000), 100)

    value = bike.value * (0.93**age) * _CONDITION_FACTOR[condition]
    starting = _round_to(value * rng.uniform(0.55, 0.7), 1_000)
    reserve = _round_to(value * rng.uniform(0.85, 0.95), 1_000) if rng.random() < 0.6 else None
    if reserve is not None and reserve < starting:
        reserve = starting

    description = " ".join(
        [
            f"{year} {bike.make} {bike.model} — a {bike.engine_cc}cc {bike.style}.",
            _CONDITION_NOTES[condition],
            *rng.sample(_EXTRAS, k=2),
        ]
    )
    return AuctionCreate(
        title=f"{year} {bike.make} {bike.model}",
        motorcycle=MotorcycleIn(
            make=bike.make,
            model=bike.model,
            year=year,
            mileage_km=mileage,
            engine_cc=bike.engine_cc,
            condition=condition,
            color=rng.choice(COLORS),
            location=rng.choice(CITIES),
            description=description,
        ),
        starting_price=starting,
        reserve_price=reserve,
        min_increment=increment_for(starting),
        starts_at=starts_at,
        ends_at=starts_at + duration,
    )


DEMO_BIDDERS = (
    ("Aarav Sharma", "aarav"), ("Diya Patel", "diya"), ("Vihaan Reddy", "vihaan"),
    ("Ananya Iyer", "ananya"), ("Kabir Singh", "kabir"), ("Meera Nair", "meera"),
    ("Rohan Gupta", "rohan"), ("Ishita Das", "ishita"), ("Arjun Menon", "arjun"),
    ("Saanvi Joshi", "saanvi"), ("Aditya Rao", "aditya"), ("Kavya Kulkarni", "kavya"),
)
DEMO_EMAIL_DOMAIN = "demo.bikebid.dev"
