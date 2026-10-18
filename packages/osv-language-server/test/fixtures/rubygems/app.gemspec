Gem::Specification.new do |spec|
  spec.name = "app"
  spec.version = "0.1.0"

  spec.add_dependency "rack", "~> 2.2"
  spec.add_runtime_dependency 'nokogiri', '>= 1.13', '< 2'
  spec.add_development_dependency("rspec", "3.0")
  spec.add_dependency "racc"
end
